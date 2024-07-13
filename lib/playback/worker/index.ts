/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import { Timeline } from "./timeline"

import * as Audio from "./audio"
import * as Video from "./video"

import * as MP4 from "../../media/mp4"
import * as Message from "./message"
import { asError } from "../../common/error"
import { Deferred } from "../../common/async"
import { GroupReader, Reader } from "../../transport/objects"

import { IDBService } from "../../common"
import { FrameData } from "../../contribute"

// Function to add received frames to the IndexedDB
const addFrames = (frames: FrameData[]) => {
	if (!db) {
		console.error("IndexedDB is not initialized.")
		return
	}

	const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readwrite")
	const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
	const addRequest = objectStore.put(frames, 1)

	// Handle the success event when the updated value is stored successfully
	addRequest.onsuccess = () => {
		// console.log("Frames successfully set:", currentTimeInMilliseconds)
	}

	// Handle any errors that occur during value storage
	addRequest.onerror = (event) => {
		console.error("Error adding frames:", (event.target as IDBRequest).error)
	}
}

class Worker {
	// Timeline receives samples, buffering them and choosing the timestamp to render.
	#timeline = new Timeline()

	// A map of init tracks.
	#inits = new Map<string, Deferred<Uint8Array>>()

	// Renderer requests samples, rendering video frames and emitting audio frames.
	#audio?: Audio.Renderer
	#video?: Video.Renderer

	allReceivedFrames: FrameData[] = []

	on(e: MessageEvent) {
		const msg = e.data as Message.ToWorker

		if (msg.config) {
			this.#onConfig(msg.config)
		} else if (msg.init) {
			// TODO buffer the init segmnet so we don't hold the stream open.
			this.#onInit(msg.init)
		} else if (msg.segment) {
			this.#onSegment(msg.segment).catch(console.warn)
		} else {
			throw new Error(`unknown message: + ${JSON.stringify(msg)}`)
		}
	}

	#onConfig(msg: Message.Config) {
		if (msg.audio) {
			this.#audio = new Audio.Renderer(msg.audio, this.#timeline.audio)
		}

		if (msg.video) {
			this.#video = new Video.Renderer(msg.video, this.#timeline.video)
		}
	}

	#onInit(msg: Message.Init) {
		IDBService.initIDBService()
		let init = this.#inits.get(msg.name)
		if (!init) {
			init = new Deferred()
			this.#inits.set(msg.name, init)
		}

		init.resolve(msg.data)
	}

	async #onSegment(msg: Message.Segment) {
		IDBService.receiveSegment(msg.header.group, Date.now())

		let init = this.#inits.get(msg.init)
		if (!init) {
			init = new Deferred()
			this.#inits.set(msg.init, init)
		}

		// Create a new stream that we will use to decode.
		const container = new MP4.Parser(await init.promise)

		const timeline = msg.kind === "audio" ? this.#timeline.audio : this.#timeline.video
		const reader = new GroupReader(msg.header, new Reader(msg.buffer, msg.stream))

		// Create a queue that will contain each MP4 frame.
		const queue = new TransformStream<MP4.Frame>({})
		const segment = queue.writable.getWriter()

		// Add the segment to the timeline
		if (!timeline.segments.locked) {
			const segments = timeline.segments.getWriter()
			await segments.write({
				sequence: msg.header.group,
				frames: queue.readable,
			})
			segments.releaseLock()
		}

		addFrames(this.allReceivedFrames)

		// Read each chunk, decoding the MP4 frames and adding them to the queue.
		for (;;) {
			const chunk = await reader.read()

			if (!chunk) {
				break
			}

			const frames = container.decode(chunk.payload)
			for (const frame of frames) {
				if (MP4.isVideoTrack(frame.track)) {
					this.allReceivedFrames.push({
						frameId: frame.sample.duration,
						size: frame.sample.size,
						type: frame.sample.is_sync ? "key" : "delta",
						receiveTime: Date.now(),
						width: frame.sample.description.width,
						height: frame.sample.description.height,
					})
				}

				await segment.write(frame)
			}
		}

		// We done.
		await segment.close().catch((e) => {
			return asError(e)
		})
	}
}

// Pass all events to the worker
const worker = new Worker()
self.addEventListener("message", (msg) => {
	try {
		worker.on(msg)
	} catch (e) {
		const err = asError(e)
		console.warn("worker error:", err)
	}
})

// Validates this is an expected message
function _send(msg: Message.FromWorker) {
	postMessage(msg)
}
