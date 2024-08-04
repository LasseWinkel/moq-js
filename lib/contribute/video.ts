import { EVALUATION_SCENARIO } from "@kixelated/moq/common/evaluationscenarios"

import { IDBService } from "@kixelated/moq/common"

const SUPPORTED = [
	"avc1", // H.264
	"hev1", // HEVC (aka h.265)
	// "av01", // TDOO support AV1
]

export interface EncoderSupported {
	codecs: string[]
}

export class Encoder {
	#encoder!: VideoEncoder
	#encoderConfig: VideoEncoderConfig
	#decoderConfig?: VideoDecoderConfig

	// true if we should insert a keyframe, undefined when the encoder should decide
	#keyframeNext: true | undefined = true

	// Count the number of frames without a keyframe.
	#keyframeCounter = 0

	// Converts raw rames to encoded frames.
	frames: TransformStream<VideoFrame, VideoDecoderConfig | EncodedVideoChunk>

	#frameId = 0

	constructor(config: VideoEncoderConfig) {
		config.bitrateMode ??= "constant"
		config.latencyMode ??= "realtime"

		this.#encoderConfig = config

		this.frames = new TransformStream({
			start: this.#start.bind(this),
			transform: this.#transform.bind(this),
			flush: this.#flush.bind(this),
		})
	}

	static async isSupported(config: VideoEncoderConfig) {
		// Check if we support a specific codec family
		const short = config.codec.substring(0, 4)
		if (!SUPPORTED.includes(short)) return false

		// Default to hardware encoding
		config.hardwareAcceleration ??= "prefer-hardware"

		// Default to CBR
		config.bitrateMode ??= "constant"

		// Default to realtime encoding
		config.latencyMode ??= "realtime"

		const res = await VideoEncoder.isConfigSupported(config)
		return !!res.supported
	}

	#start(controller: TransformStreamDefaultController<EncodedVideoChunk>) {
		this.#encoder = new VideoEncoder({
			output: (frame, metadata) => {
				this.#enqueue(controller, frame, metadata).catch((e) => console.warn(e))
			},
			error: (err) => {
				throw err
			},
		})

		this.#encoder.configure(this.#encoderConfig)
	}

	async #transform(frame: VideoFrame) {
		const encoder = this.#encoder

		IDBService.addRawVideoFrameTimestamp(frame, Date.now(), this.#frameId)
		this.#frameId++

		const bitrateSettings = await IDBService.retrieveBitrateSettings()

		this.#encoder.configure({
			...this.#encoderConfig,
			bitrateMode: bitrateSettings.bitrateMode.toLowerCase() as VideoEncoderBitrateMode,
			bitrate: bitrateSettings.bitrate,
		})

		// Set keyFrame to undefined when we're not sure so the encoder can decide.
		encoder.encode(frame, { keyFrame: this.#keyframeNext })
		this.#keyframeNext = undefined

		frame.close()
	}

	async #enqueue(
		controller: TransformStreamDefaultController<VideoDecoderConfig | EncodedVideoChunk>,
		frame: EncodedVideoChunk,
		metadata?: EncodedVideoChunkMetadata,
	) {
		if (!this.#decoderConfig) {
			const config = metadata?.decoderConfig
			if (!config) throw new Error("missing decoder config")

			controller.enqueue(config)
			this.#decoderConfig = config
		}

		const keyFrameIntervalSizeFromIndexedDB = await IDBService.retrieveKeyFrameIntervalSize()

		const keyFrameIntervalSize = keyFrameIntervalSizeFromIndexedDB
			? keyFrameIntervalSizeFromIndexedDB
			: EVALUATION_SCENARIO.gopDefault

		if (frame.type === "key") {
			this.#keyframeCounter = 0
		} else {
			this.#keyframeCounter += 1
			if (
				this.#keyframeCounter + this.#encoder.encodeQueueSize >=
				keyFrameIntervalSize * this.#encoderConfig.framerate!
			) {
				this.#keyframeNext = true
			}
		}

		controller.enqueue(frame)
	}

	#flush() {
		this.#encoder.close()
	}

	get config() {
		return this.#encoderConfig
	}
}
