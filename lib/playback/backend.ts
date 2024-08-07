/// <reference types="vite/client" />

import * as Message from "./worker/message"
import { Audio } from "./audio"

import MediaWorker from "./worker?worker"
import { RingShared } from "../common/ring"
import { Catalog, isAudioTrack } from "../media/catalog"
import { GroupHeader } from "../transport/objects"

export interface PlayerConfig {
	canvas: OffscreenCanvas
	catalog: Catalog
}

// This is a non-standard way of importing worklet/workers.
// Unfortunately, it's the only option because of a Vite bug: https://github.com/vitejs/vite/issues/11823

// Responsible for sending messages to the worker and worklet.
export default class Backend {
	// General worker
	#worker: Worker

	// The audio context, which must be created on the main thread.
	#audio?: Audio

	constructor(config: PlayerConfig) {
		// TODO does this block the main thread? If so, make this async
		// @ts-expect-error: The Vite typing is wrong https://github.com/vitejs/vite/blob/22bd67d70a1390daae19ca33d7de162140d533d6/packages/vite/client.d.ts#L182
		this.#worker = new MediaWorker({ format: "es" })
		this.#worker.addEventListener("message", this.on.bind(this))

		let sampleRate: number | undefined
		let channels: number | undefined

		for (const track of config.catalog.tracks) {
			if (isAudioTrack(track)) {
				if (sampleRate && track.sample_rate !== sampleRate) {
					throw new Error(`TODO multiple audio tracks with different sample rates`)
				}

				sampleRate = track.sample_rate
				channels = Math.max(track.channel_count, channels ?? 0)
			}
		}

		const msg: Message.Config = {}

		// Only configure audio is we have an audio track
		if (sampleRate && channels) {
			msg.audio = {
				channels: channels,
				sampleRate: sampleRate,
				ring: new RingShared(2, sampleRate / 20), // 50ms
			}

			this.#audio = new Audio(msg.audio)
		}

		// TODO only send the canvas if we have a video track
		msg.video = {
			canvas: config.canvas,
		}

		this.send({ config: msg }, msg.video.canvas)
	}

	async play() {
		await this.#audio?.context.resume()
	}

	init(init: Init) {
		this.send({ init })
	}

	segment(segment: Segment) {
		this.send({ segment }, segment.stream)
	}

	async close() {
		this.#worker.terminate()
		await this.#audio?.context.close()
	}

	// Enforce we're sending valid types to the worker
	private send(msg: Message.ToWorker, ...transfer: Transferable[]) {
		//console.log("sent message from main to worker", msg)
		this.#worker.postMessage(msg, transfer)
	}

	private on(e: MessageEvent) {
		const msg = e.data as Message.FromWorker

		// Don't print the verbose timeline message.
		if (!msg.timeline) {
			// console.log("received message from worker to main", msg)
		}
		if (msg.renderedFramesRawData) {
			let frameIndex = 0
			let frameIndexTimeout = 0
			msg.renderedFramesRawData.forEach((rawData) => {
				// Save the raw data to disk
				frameIndexTimeout++
				setTimeout(() => {
					saveRawDataToFile(rawData, `frame-${frameIndex}.raw`)
					console.log(frameIndex)
					frameIndex++
				}, 100 * frameIndexTimeout)
			})
		}
	}
}

function saveRawDataToFile(rawData: ArrayBufferLike, filename: string) {
	// Create a Blob from the raw data
	const blob = new Blob([rawData], { type: "application/octet-stream" })

	// Create a link element
	const link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	link.download = filename

	// Append the link to the document and trigger a click to download the file
	document.body.appendChild(link)
	link.click()

	// Remove the link from the document
	document.body.removeChild(link)
}

export interface Init {
	name: string // name of the init track
	data: Uint8Array
}

export interface Segment {
	init: string // name of the init track
	kind: "audio" | "video"
	header: GroupHeader
	buffer: Uint8Array
	stream: ReadableStream<Uint8Array>
}
