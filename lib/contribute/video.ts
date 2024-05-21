const SUPPORTED = [
	"avc1", // H.264
	"hev1", // HEVC (aka h.265)
	// "av01", // TDOO support AV1
]
/*
// Utility function to download collected data.
function downloadData(data: any[]): void {
	const jsonData = JSON.stringify(data)
	const blob = new Blob([jsonData], {
		type: "application/json",
	})

	const link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	link.download = "transform_time"

	// Append the link to the body
	document.body.appendChild(link)

	// Programmatically click the link to trigger the download
	link.click()

	// Clean up
	document.body.removeChild(link)
} */

export const IndexedDatabaseName = "IndexedDB"

export enum IndexedDBObjectStores {
	FRAMES = "Frames",
	KEY_FRAME_INTERVAL_SIZE = "KeyFrameIntervalSize",
	START_STREAM_TIME = "StartStreamTime",
}

export interface IndexedDBFramesSchema {
	_1_rawVideoTimestamp: number
	_2_segmentationTime: number
	_3_segmentationTimestamp: number
	_4_propagationTime: number
	_5_receiveMp4FrameTimestamp: number
	_6_renderFrameTime: number
	_7_renderFrameTimestamp: number
	_8_totalTime: number
	_9_originalTimestampAttribute: number
	_10_encodedTimestampAttribute: number
	_11_decodedTimestampAttribute: number
	_12_renderTimestampAttribute: number
	_13_sentBytes: number
	_14_receivedBytes: number
	_15_sentType: string
	_16_receivedType: string
	_17_width: number
	_18_height: number
	_19_segmentID: number
}

let db: IDBDatabase

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
	/*
	#seenFrames: { timestamp: number; transformTime: number }[] = []
	#downloaded = false */

	// Converts raw rames to encoded frames.
	frames: TransformStream<VideoFrame, VideoDecoderConfig | EncodedVideoChunk>

	constructor(config: VideoEncoderConfig) {
		// Open IndexedDB
		const openRequest = indexedDB.open(IndexedDatabaseName, 1)

		// Handle the success event when the database is successfully opened
		openRequest.onsuccess = (event) => {
			db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened
		}

		config.bitrateMode ??= "constant"
		config.latencyMode ??= "realtime"

		this.#encoderConfig = config

		this.frames = new TransformStream({
			start: this.#start.bind(this),
			transform: this.#transform.bind(this),
			flush: this.#flush.bind(this),
		})
	}

	// Function to add the time of creation for each frame in IndexedDB
	addRawVideoFrameTimestamp(frame: VideoFrame, currentTimeInMilliseconds: number) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
		const newFrame = {
			_1_rawVideoTimestamp: currentTimeInMilliseconds,
			_9_originalTimestampAttribute: frame.timestamp,
		} as IndexedDBFramesSchema
		const addRequest = objectStore.add(newFrame, frame.timestamp)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Frame added successfully. New frame:", newFrame, frameID)
		}

		// Handle any errors that occur during value retrieval
		addRequest.onerror = (event) => {
			console.error("Error adding current frame:", (event.target as IDBRequest).error)
		}
	}

	// Function to retrieve the key frame interval size from IndexedDB
	retrieveKeyFrameIntervalSize = (): Promise<number | undefined> => {
		return new Promise((resolve, reject) => {
			if (!db) {
				console.error("IndexedDB is not initialized.")
				return
			}

			const transaction = db.transaction(IndexedDBObjectStores.KEY_FRAME_INTERVAL_SIZE, "readonly")
			const objectStore = transaction.objectStore(IndexedDBObjectStores.KEY_FRAME_INTERVAL_SIZE)
			const getRequest = objectStore.get(0)

			// Handle the success event when the updated value is retrieved successfully
			getRequest.onsuccess = (event) => {
				const keyFrameIntervalSize: number | undefined = (event.target as IDBRequest).result
				// console.log("Key frame interval size successfully retrieved:", keyFrameIntervalSize)
				resolve(keyFrameIntervalSize)
			}

			// Handle any errors that occur during value retrieval
			getRequest.onerror = (event) => {
				console.error("Error retrieving key frame interval size:", (event.target as IDBRequest).error)
				reject((event.target as IDBRequest).error)
			}
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

	#transform(frame: VideoFrame) {
		const encoder = this.#encoder

		this.addRawVideoFrameTimestamp(frame, Date.now())
		/* 	this.#seenFrames.push({ timestamp: frame.timestamp, transformTime: performance.now() })

		setTimeout(() => {
			if (!this.#downloaded) {
				downloadData(this.#seenFrames)
			}
			this.#downloaded = true
		}, 30000) */

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

		const keyFrameIntervalSizeFromIndexedDB = await this.retrieveKeyFrameIntervalSize()
		// console.log("Key frame interval size from IDB", keyFrameIntervalSizeFromIndexedDB)

		const keyFrameIntervalSize = keyFrameIntervalSizeFromIndexedDB
			? keyFrameIntervalSizeFromIndexedDB
			: 2 * this.#encoderConfig.framerate!

		if (frame.type === "key") {
			this.#keyframeCounter = 0
		} else {
			this.#keyframeCounter += 1
			if (this.#keyframeCounter + this.#encoder.encodeQueueSize >= keyFrameIntervalSize) {
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
