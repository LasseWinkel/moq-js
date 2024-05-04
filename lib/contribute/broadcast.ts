import { Connection, SubscribeRecv } from "../transport"
import { asError } from "../common/error"
import { Segment } from "./segment"
import { Track } from "./track"
import { Catalog, Mp4Track, VideoTrack, Track as CatalogTrack, AudioTrack } from "../media/catalog"

import { isAudioTrackSettings, isVideoTrackSettings } from "../common/settings"

import { IndexedDBObjectStores, IndexedDBFramesSchema, IndexedDatabaseName } from "./video"

let db: IDBDatabase

// Function to add the time for each frame when they are written to the stream in IndexedDB
const addFrameToStreamTimestamp = (frame: { timestamp: number; byteLength: number }, currentDateTime: number) => {
	if (!db) {
		console.error("IndexedDB is not initialized.")
		return
	}

	const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readwrite")
	const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
	const updateRequest = objectStore.get(frame.timestamp)

	// Handle the success event when the current value is retrieved successfully
	updateRequest.onsuccess = (event) => {
		const currentFrame: IndexedDBFramesSchema = (event.target as IDBRequest).result ?? {} // Retrieve the current value

		const updatedFrame = {
			...currentFrame,
			_2_segmentationTime: currentDateTime - currentFrame._1_rawVideoTimestamp,
			_3_segmentationTimestamp: currentDateTime,
			_10_encodedTimestampAttribute: frame.timestamp,
			_13_sentBytes: frame.byteLength - 108, // 108 bytes are somehow added along the path but not received
		} as IndexedDBFramesSchema

		const putRequest = objectStore.put(updatedFrame, frame.timestamp) // Store the updated value back into the database

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

export interface BroadcastConfig {
	namespace: string
	connection: Connection
	media: MediaStream

	audio?: AudioEncoderConfig
	video?: VideoEncoderConfig
}

export interface BroadcastConfigTrack {
	codec: string
	bitrate: number
}

export class Broadcast {
	#tracks = new Map<string, Track>()

	readonly config: BroadcastConfig
	readonly catalog: Catalog
	readonly connection: Connection

	#running: Promise<void>

	constructor(config: BroadcastConfig) {
		// Open IndexedDB
		const openRequest = indexedDB.open(IndexedDatabaseName, 1)

		// Handle the success event when the database is successfully opened
		openRequest.onsuccess = (event) => {
			db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened
		}
		this.connection = config.connection
		this.config = config
		this.catalog = new Catalog(config.namespace)

		for (const media of this.config.media.getTracks()) {
			const track = new Track(media, config)
			this.#tracks.set(track.name, track)

			const settings = media.getSettings()

			let catalog: CatalogTrack

			const mp4Catalog: Mp4Track = {
				container: "mp4",
				kind: media.kind,
				init_track: `${track.name}.mp4`,
				data_track: `${track.name}.m4s`,
			}

			if (isVideoTrackSettings(settings)) {
				if (!config.video) {
					throw new Error("no video configuration provided")
				}

				const videoCatalog: VideoTrack = {
					...mp4Catalog,
					kind: "video",
					codec: config.video.codec,
					width: settings.width,
					height: settings.height,
					frame_rate: settings.frameRate,
					bit_rate: config.video.bitrate,
				}

				catalog = videoCatalog
			} else if (isAudioTrackSettings(settings)) {
				if (!config.audio) {
					throw new Error("no audio configuration provided")
				}

				const audioCatalog: AudioTrack = {
					...mp4Catalog,
					kind: "audio",
					codec: config.audio.codec,
					sample_rate: settings.sampleRate,
					sample_size: settings.sampleSize,
					channel_count: settings.channelCount,
					bit_rate: config.audio.bitrate,
				}

				catalog = audioCatalog
			} else {
				throw new Error(`unknown track type: ${media.kind}`)
			}

			this.catalog.tracks.push(catalog)
		}

		this.#running = this.#run()
	}

	async #run() {
		await this.connection.announce(this.catalog.namespace)

		for (;;) {
			const subscriber = await this.connection.subscribed()
			if (!subscriber) break

			// Run an async task to serve each subscription.
			this.#serveSubscribe(subscriber).catch((e) => {
				const err = asError(e)
				console.warn("failed to serve subscribe", err)
			})
		}
	}

	async #serveSubscribe(subscriber: SubscribeRecv) {
		try {
			const [base, ext] = splitExt(subscriber.track)
			if (ext === "catalog") {
				await this.#serveCatalog(subscriber, base)
			} else if (ext === "mp4") {
				await this.#serveInit(subscriber, base)
			} else if (ext === "m4s") {
				await this.#serveTrack(subscriber, base)
			} else {
				throw new Error(`unknown subscription: ${subscriber.track}`)
			}
		} catch (e) {
			const err = asError(e)
			await subscriber.close(1n, `failed to process subscribe: ${err.message}`)
		} finally {
			// TODO we can't close subscribers because there's no support for clean termination
			// await subscriber.close()
		}
	}

	async #serveCatalog(subscriber: SubscribeRecv, name: string) {
		// We only support ".catalog"
		if (name !== "") throw new Error(`unknown catalog: ${name}`)

		const bytes = this.catalog.encode()

		// Send a SUBSCRIBE_OK
		await subscriber.ack()

		const stream = await subscriber.group({ group: 0 })
		await stream.write({ object: 0, payload: bytes })
		await stream.close()
	}

	async #serveInit(subscriber: SubscribeRecv, name: string) {
		const track = this.#tracks.get(name)
		if (!track) throw new Error(`no track with name ${subscriber.track}`)

		// Send a SUBSCRIBE_OK
		await subscriber.ack()

		const init = await track.init()

		const stream = await subscriber.group({ group: 0 })
		await stream.write({ object: 0, payload: init })
		await stream.close()
	}

	async #serveTrack(subscriber: SubscribeRecv, name: string) {
		const track = this.#tracks.get(name)
		if (!track) throw new Error(`no track with name ${subscriber.track}`)

		// Send a SUBSCRIBE_OK
		await subscriber.ack()

		const segments = track.segments().getReader()

		for (;;) {
			const { value: segment, done } = await segments.read()
			if (done) break

			// Serve the segment and log any errors that occur.
			this.#serveSegment(subscriber, segment).catch((e) => {
				const err = asError(e)
				console.warn("failed to serve segment", err)
			})
		}
	}

	async #serveSegment(subscriber: SubscribeRecv, segment: Segment) {
		// Create a new stream for each segment.
		const stream = await subscriber.group({
			group: segment.id,
			priority: 0, // TODO
		})

		let object = 0

		// Pipe the segment to the stream.
		const chunks = segment.chunks().getReader()
		for (;;) {
			const { value, done } = await chunks.read()
			if (done) break

			// Check whether the frame is a video frame
			if (segment.timestamp < 1000000000) {
				addFrameToStreamTimestamp({ timestamp: segment.timestamp, byteLength: value.byteLength }, Date.now())
			}

			await stream.write({
				object,
				payload: value,
			})

			object += 1
		}

		await stream.close()
	}

	// Attach the captured video stream to the given video element.
	attach(video: HTMLVideoElement) {
		video.srcObject = this.config.media
	}

	close() {
		// TODO implement publish close
	}

	// Returns the error message when the connection is closed
	async closed(): Promise<Error> {
		try {
			await this.#running
			return new Error("closed") // clean termination
		} catch (e) {
			return asError(e)
		}
	}
}

function splitExt(s: string): [string, string] {
	const i = s.lastIndexOf(".")
	if (i < 0) throw new Error(`no extension found`)
	return [s.substring(0, i), s.substring(i + 1)]
}
