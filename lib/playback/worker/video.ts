import { Frame, Component } from "./timeline"
import * as MP4 from "../../media/mp4"
import * as Message from "./message"
import { IDBService } from "../../common"

// 30 Fps
// const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 5472
// const FRAME_SIZE_TO_END_DOWNLOAD = 2597

// 24 Fps Scenic GoP
// const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 12572
// const FRAME_SIZE_TO_END_DOWNLOAD = 9762

// 24 Fps GoP 12
// const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 53301
// const FRAME_SIZE_TO_END_DOWNLOAD = 106914

// 24 Fps GoP 24
// const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 55131
// const FRAME_SIZE_TO_END_DOWNLOAD = 108892

// 24 Fps GoP 48
// const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 55631
// const FRAME_SIZE_TO_END_DOWNLOAD = 109369

// 24 Fps Frankenstein GoP 48 - 12 - 48
// const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 15023
// const FRAME_SIZE_TO_END_DOWNLOAD = 3200

// 24 Fps BBB Frankenstein GoP 48 - 12 - 48
// const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 11831
// const FRAME_SIZE_TO_END_DOWNLOAD = 3223

// 24 Fps Large BBB Frankenstein GoP 48 - 12 - 48
const FRAME_SIZE_TO_BEGIN_DOWNLOAD = 33587
const FRAME_SIZE_TO_END_DOWNLOAD = 7251

export class Renderer {
	#canvas: OffscreenCanvas
	#timeline: Component

	#decoder!: VideoDecoder
	#queue: TransformStream<Frame, VideoFrame>

	#encodedRawFramesData: Uint8Array[] = []

	#frameCount = 0
	#shouldDownload = false

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

		for (;;) {
			const { value: frame, done } = await reader.read()
			if (done) break

			self.requestAnimationFrame(() => {
				this.#canvas.width = frame.displayWidth
				this.#canvas.height = frame.displayHeight

				// const ctx = this.#canvas.getContext("2d")
				const ctx = this.#canvas.getContext("2d", { willReadFrequently: true })
				if (!ctx) throw new Error("failed to get canvas context")

				IDBService.addRenderFrameTimestampSubscriber(frame, Date.now())

				ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight) // TODO respect aspect ratio

				// Access raw image data
				const imageData = ctx.getImageData(0, 0, frame.displayWidth, frame.displayHeight)
				const rawData = imageData.data.buffer

				if (this.#shouldDownload) {
					const renderedFramesRawData = { renderTime: Date.now(), rawData }
					this.#frameCount++
					setTimeout(() => {
						postMessage({ renderedFramesRawData })
					}, 500 * this.#frameCount)
				}
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

		if (frame.sample.size === FRAME_SIZE_TO_BEGIN_DOWNLOAD) {
			console.log(frame)
			this.#shouldDownload = true
		}

		if (frame.sample.size === FRAME_SIZE_TO_END_DOWNLOAD) {
			console.log(frame)
			this.#shouldDownload = false
		}

		/* if (this.#encodedRawFramesData.length === 0) {
			const encodedRawFramesData = this.#encodedRawFramesData
			setTimeout(() => {
				postMessage({ encodedRawFramesData })
			}, 5000)
		}

		this.#encodedRawFramesData.push(frame.sample.data) */

		this.#decoder.decode(chunk)
	}
}
