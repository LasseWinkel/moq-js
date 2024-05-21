import { Segment } from "./segment"
import { Notify } from "../common/async"
import { Chunk } from "./chunk"
import { Container } from "./container"
import { BroadcastConfig } from "./broadcast"

import * as Audio from "./audio"
import * as Video from "./video"

import { IndexedDBObjectStores, IndexedDBFramesSchema, IndexedDatabaseName } from "./video"

let db: IDBDatabase

// Function to add the time for each frame when they are written to the stream in IndexedDB
const addFrameToStreamTimestamp = (frame: Chunk, currentDateTime: number, segmentID: number, frameId: number) => {
	if (!db) {
		console.error("IndexedDB is not initialized.")
		return
	}

	const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readwrite")
	const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
	const updateRequest = objectStore.get(frameId)

	// Handle the success event when the current value is retrieved successfully
	updateRequest.onsuccess = (event) => {
		const currentFrame: IndexedDBFramesSchema = (event.target as IDBRequest).result ?? {} // Retrieve the current value

		const updatedFrame = {
			...currentFrame,
			_2_segmentationTime: currentDateTime - currentFrame._1_rawVideoTimestamp,
			_3_segmentationTimestamp: currentDateTime,
			_10_encodedTimestampAttribute: frame.timestamp,
			_13_sentBytes: frame.data.byteLength - 108, // 108 bytes are somehow added along the path but not received
			_15_sentType: frame.type,
			_19_segmentID: segmentID,
		} as IndexedDBFramesSchema

		const putRequest = objectStore.put(updatedFrame, frameId) // Store the updated value back into the database

		// Handle the success event when the updated value is stored successfully
		putRequest.onsuccess = () => {
			// console.log("Frame updated successfully. New value:", updatedFrame)
		}

		// Handle any errors that occur during value storage
		putRequest.onerror = (event) => {
			console.error("Error storing updated value:", (event.target as IDBRequest).error)
		}
	}

	// Handle any errors that occur during value retrieval
	updateRequest.onerror = (event) => {
		console.error("Error updating frame:", (event.target as IDBRequest).error)
	}
}

export class Track {
	name: string

	#init?: Uint8Array
	#segments: Segment[] = []

	#offset = 0 // number of segments removed from the front of the queue
	#closed = false
	#error?: Error
	#notify = new Notify()

	#frameId = 0

	constructor(media: MediaStreamTrack, config: BroadcastConfig) {
		// Open IndexedDB
		const openRequest = indexedDB.open(IndexedDatabaseName, 1)

		// Handle the success event when the database is successfully opened
		openRequest.onsuccess = (event) => {
			db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened
		}

		// TODO allow multiple tracks of the same kind
		this.name = media.kind

		// We need to split based on type because Typescript is hard
		if (isAudioTrack(media)) {
			if (!config.audio) throw new Error("no audio config")
			this.#runAudio(media, config.audio).catch((err) => this.#close(err))
		} else if (isVideoTrack(media)) {
			if (!config.video) throw new Error("no video config")
			this.#runVideo(media, config.video).catch((err) => this.#close(err))
		} else {
			throw new Error(`unknown track type: ${media.kind}`)
		}
	}

	async #runAudio(track: MediaStreamAudioTrack, config: AudioEncoderConfig) {
		const source = new MediaStreamTrackProcessor({ track })
		const encoder = new Audio.Encoder(config)
		const container = new Container()

		// Split the container at keyframe boundaries
		const segments = new WritableStream({
			write: (chunk) => this.#write(chunk),
			close: () => this.#close(),
			abort: (e) => this.#close(e),
		})

		return source.readable.pipeThrough(encoder.frames).pipeThrough(container.encode).pipeTo(segments)
	}

	async #runVideo(track: MediaStreamVideoTrack, config: VideoEncoderConfig) {
		const source = new MediaStreamTrackProcessor({ track })
		const encoder = new Video.Encoder(config)
		const container = new Container()

		// Split the container at keyframe boundaries
		const segments = new WritableStream({
			write: (chunk) => this.#write(chunk),
			close: () => this.#close(),
			abort: (e) => this.#close(e),
		})

		return source.readable.pipeThrough(encoder.frames).pipeThrough(container.encode).pipeTo(segments)
	}

	async #write(chunk: Chunk) {
		if (chunk.type === "init") {
			this.#init = chunk.data
			this.#notify.wake()
			return
		}

		let current = this.#segments.at(-1)
		const segmentID = this.#offset + this.#segments.length

		if (!current || chunk.type === "key") {
			if (current) {
				await current.input.close()
			}

			const segment = new Segment(segmentID)
			this.#segments.push(segment)

			this.#notify.wake()

			current = segment

			// Clear old segments
			while (this.#segments.length > 1) {
				const first = this.#segments[0]

				// Expire after 10s
				if (chunk.timestamp - first.timestamp < 10_000_000) break
				this.#segments.shift()
				this.#offset += 1

				await first.input.abort("expired")
			}
		}

		const writer = current.input.getWriter()

		if ((writer.desiredSize || 0) > 0) {
			await writer.write(chunk)
			// Check whether the frame is a video frame
			if (chunk.duration === 0) {
				addFrameToStreamTimestamp(chunk, Date.now(), segmentID, this.#frameId)
				this.#frameId++
			}
		} else {
			console.warn("dropping chunk", writer.desiredSize)
		}

		writer.releaseLock()
	}

	async #close(e?: Error) {
		this.#error = e

		const current = this.#segments.at(-1)
		if (current) {
			await current.input.close()
		}

		this.#closed = true
		this.#notify.wake()
	}

	async init(): Promise<Uint8Array> {
		while (!this.#init) {
			if (this.#closed) throw new Error("track closed")
			await this.#notify.wait()
		}

		return this.#init
	}

	// TODO generize this
	segments(): ReadableStream<Segment> {
		let pos = this.#offset

		return new ReadableStream({
			pull: async (controller) => {
				for (;;) {
					let index = pos - this.#offset
					if (index < 0) index = 0

					if (index < this.#segments.length) {
						controller.enqueue(this.#segments[index])
						pos += 1
						return // Called again when more data is requested
					}

					if (this.#error) {
						controller.error(this.#error)
						return
					} else if (this.#closed) {
						controller.close()
						return
					}

					// Pull again on wakeup
					// NOTE: We can't return until we enqueue at least one segment.
					await this.#notify.wait()
				}
			},
		})
	}
}

function isAudioTrack(track: MediaStreamTrack): track is MediaStreamAudioTrack {
	return track.kind === "audio"
}

function isVideoTrack(track: MediaStreamTrack): track is MediaStreamVideoTrack {
	return track.kind === "video"
}
