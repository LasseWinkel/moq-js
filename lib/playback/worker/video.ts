import { Frame, Component } from "./timeline"
import * as MP4 from "../../media/mp4"
import * as Message from "./message"

import { IDBService } from "../../common"

export class Renderer {
	#canvas: OffscreenCanvas
	#timeline: Component

	#decoder!: VideoDecoder
	#queue: TransformStream<Frame, VideoFrame>

	constructor(config: Message.ConfigVideo, timeline: Component) {
		this.#canvas = config.canvas
		this.#timeline = timeline

		this.#queue = new TransformStream({
			start: this.#start.bind(this),
			transform: this.#transform.bind(this),
		})

		this.#run().catch(console.error)
	}

	async #run() {
		const reader = this.#timeline.frames.pipeThrough(this.#queue).getReader()
		const renderedFramesRawData: ArrayBufferLike[] = []

		for (;;) {
			const { value: frame, done } = await reader.read()
			if (done) break

			self.requestAnimationFrame(() => {
				this.#canvas.width = frame.displayWidth
				this.#canvas.height = frame.displayHeight

				const ctx = this.#canvas.getContext("2d")
				// const ctx = this.#canvas.getContext("2d", { willReadFrequently: true })
				if (!ctx) throw new Error("failed to get canvas context")

				IDBService.addRenderFrameTimestamp(frame, Date.now())

				ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight) // TODO respect aspect ratio

				/* // Access raw image data
				const imageData = ctx.getImageData(0, 0, frame.displayWidth, frame.displayHeight)
				const rawData = imageData.data.buffer

				if (renderedFramesRawData.length <= 900) {
					renderedFramesRawData.push(rawData)
				}
				if (renderedFramesRawData.length === 900) {
					postMessage({ renderedFramesRawData })
				} */
				frame.close()
			})
		}
	}

	#start(controller: TransformStreamDefaultController<VideoFrame>) {
		this.#decoder = new VideoDecoder({
			output: (frame: VideoFrame) => {
				controller.enqueue(frame)
			},
			error: console.error,
		})
	}

	#transform(frame: Frame) {
		// Configure the decoder with the first frame
		if (this.#decoder.state !== "configured") {
			const { sample, track } = frame

			const desc = sample.description
			const box = desc.avcC ?? desc.hvcC ?? desc.vpcC ?? desc.av1C
			if (!box) throw new Error(`unsupported codec: ${track.codec}`)

			const buffer = new MP4.Stream(undefined, 0, MP4.Stream.BIG_ENDIAN)
			box.write(buffer)
			const description = new Uint8Array(buffer.buffer, 8) // Remove the box header.

			if (!MP4.isVideoTrack(track)) throw new Error("expected video track")

			this.#decoder.configure({
				codec: track.codec,
				codedHeight: track.video.height,
				codedWidth: track.video.width,
				description,
				// optimizeForLatency: true
			})
		}

		const chunk = new EncodedVideoChunk({
			type: frame.sample.is_sync ? "key" : "delta",
			data: frame.sample.data,
			timestamp: frame.sample.dts,
			duration: frame.sample.duration,
		})

		this.#decoder.decode(chunk)
	}
}
