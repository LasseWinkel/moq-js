import { EVALUATION_SCENARIO } from "./evaluationscenarios"

export const IndexedDatabaseName = "IndexedDB"

export enum IndexedDBObjectStores {
	FRAMES = "Frames",
	SEGMENTS = "Segments",
	KEY_FRAME_INTERVAL_SIZE = "KeyFrameIntervalSize",
	START_STREAM_TIME = "StartStreamTime",
	BITRATE_OPTIONS = "Bitrate",
}

export enum BitrateMode {
	CONSTANT = "Constant",
	VARIABLE = "Variable",
}

export interface IndexedDBFramesSchema {
	_1_rawVideoTimestamp: number
	_2_encodingTime: number
	_3_segmentationTimestamp: number
	_4_propagationTime: number
	_5_receiveMp4FrameTimestamp: number
	_6_decodingTime: number
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

export interface IndexedDBSegmentsSchema {
	segmentID: number
	sentTimestamp: number
	propagationTime: number
	receivedTimestamp: number
}

export interface BitrateOptions {
	bitrateMode: BitrateMode
	bitrate: number
}

export interface IndexedDBFramesSchemaSubscriber {
	frameId: number
	size: number
	type: string
	receiveTime: number
	width: number
	height: number
}

export interface IndexedDBSegmentsSchemaSubscriber {
	id: number
	propagationTime: number
	receiveTime: number
}

export const IndexedDBNameSubscriber = "IndexedDBSubscriber"

export enum IndexedDBObjectStoresSubscriber {
	SEGMENTS = "Segments",
	FRAMES = "Frames",
}

let db: IDBDatabase

let subscriberDB: IDBDatabase

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class IDBService {
	static initIDBService() {
		// Open IndexedDB
		const openRequest = indexedDB.open(IndexedDatabaseName, 1)

		// Handle the success event when the database is successfully opened
		openRequest.onsuccess = (event) => {
			db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened
		}

		// Handle the upgrade needed event to create or upgrade the database schema
		openRequest.onupgradeneeded = (event) => {
			console.log("UPGRADE_NEEDED")

			db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened
			// Check if the object store already exists
			if (!db.objectStoreNames.contains(IndexedDBObjectStores.FRAMES)) {
				// Create an object store (similar to a table in SQL databases)
				db.createObjectStore(IndexedDBObjectStores.FRAMES, { autoIncrement: true })
			}

			if (!db.objectStoreNames.contains(IndexedDBObjectStores.SEGMENTS)) {
				db.createObjectStore(IndexedDBObjectStores.SEGMENTS)
			}

			if (!db.objectStoreNames.contains(IndexedDBObjectStores.KEY_FRAME_INTERVAL_SIZE)) {
				db.createObjectStore(IndexedDBObjectStores.KEY_FRAME_INTERVAL_SIZE)
			}

			if (!db.objectStoreNames.contains(IndexedDBObjectStores.START_STREAM_TIME)) {
				db.createObjectStore(IndexedDBObjectStores.START_STREAM_TIME)
			}

			if (!db.objectStoreNames.contains(IndexedDBObjectStores.BITRATE_OPTIONS)) {
				db.createObjectStore(IndexedDBObjectStores.BITRATE_OPTIONS)
			}
		}
	}

	static initIDBServiceSubscriber() {
		// Open IndexedDB
		const openRequest = indexedDB.open(IndexedDBNameSubscriber, 1)

		// Handle the success event when the database is successfully opened
		openRequest.onsuccess = (event) => {
			subscriberDB = (event.target as IDBOpenDBRequest).result // Assign subscriberDB when database is opened
		}

		// Handle the upgrade needed event to create or upgrade the database schema
		openRequest.onupgradeneeded = (event) => {
			console.log("UPGRADE_NEEDED")

			subscriberDB = (event.target as IDBOpenDBRequest).result // Assign subscriberDB when database is opened
			// Check if the object store already exists
			if (!subscriberDB.objectStoreNames.contains(IndexedDBObjectStoresSubscriber.FRAMES)) {
				subscriberDB.createObjectStore(IndexedDBObjectStoresSubscriber.FRAMES)
			}

			if (!subscriberDB.objectStoreNames.contains(IndexedDBObjectStoresSubscriber.SEGMENTS)) {
				subscriberDB.createObjectStore(IndexedDBObjectStoresSubscriber.SEGMENTS)
			}
		}
	}

	// Function to initialize the IndexedDB
	static resetIndexedDB() {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		console.log("RESET")

		for (const objectStoreName of db.objectStoreNames) {
			const transaction = db.transaction(objectStoreName, "readwrite")

			const objectStore = transaction.objectStore(objectStoreName)

			const initObjectStore = objectStore.clear()

			// Handle the success event when the store is reset successfully
			initObjectStore.onsuccess = () => {
				// console.log("Store successfully reset")
			}

			// Handle any errors that occur during store reset
			initObjectStore.onerror = (event) => {
				console.error("Error during store reset:", (event.target as IDBRequest).error)
			}
		}

		this.changeBitrateMode(BitrateMode.CONSTANT)
		this.changeBitrate(EVALUATION_SCENARIO.bitrate)
	}

	// Function to initialize the IndexedDB
	static resetIndexedDBSubscriber() {
		if (!subscriberDB) {
			console.error("IndexedDB is not initialized.")
			return
		}

		console.log("RESET")

		for (const objectStoreName of subscriberDB.objectStoreNames) {
			const transaction = subscriberDB.transaction(objectStoreName, "readwrite")

			const objectStore = transaction.objectStore(objectStoreName)

			const initObjectStore = objectStore.clear()

			// Handle the success event when the store is reset successfully
			initObjectStore.onsuccess = () => {
				// console.log("Store successfully reset")
			}

			// Handle any errors that occur during store reset
			initObjectStore.onerror = (event) => {
				console.error("Error during store reset:", (event.target as IDBRequest).error)
			}
		}
	}

	// Function to add the start time of the stream in IndexedDB
	static addStreamStartTime(currentTimeInMilliseconds: number) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.START_STREAM_TIME, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.START_STREAM_TIME)
		const addRequest = objectStore.add(currentTimeInMilliseconds, 1)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Start time successfully set:", currentTimeInMilliseconds)
		}

		// Handle any errors that occur during value storage
		addRequest.onerror = (event) => {
			console.error("Error adding start time:", (event.target as IDBRequest).error)
		}
	}

	// Function to add the time of creation for each frame in IndexedDB
	static addRawVideoFrameTimestamp(frame: VideoFrame, currentTimeInMilliseconds: number, frameId: number) {
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
		const addRequest = objectStore.add(newFrame, frameId)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Frame added successfully. New frame:", newFrame, frameId)
		}

		// Handle any errors that occur during value storage
		addRequest.onerror = (event) => {
			console.error("Error adding current frame:", (event.target as IDBRequest).error)
		}
	}

	// Function to retrieve the key frame interval size from IndexedDB
	static retrieveKeyFrameIntervalSize(): Promise<number | undefined> {
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

	// Function to add the time for each segment when they are written to the stream in IndexedDB
	static addSegmentToStreamTimestamp(segmentID: number, currentDateTime: number) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.SEGMENTS, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.SEGMENTS)
		const newSegment = {
			segmentID: segmentID,
			sentTimestamp: currentDateTime,
		} as IndexedDBSegmentsSchema
		const addRequest = objectStore.add(newSegment, segmentID)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Segment added successfully. New segment:", newSegment, segmentID)
		}

		// Handle any errors that occur during value storage
		addRequest.onerror = (event) => {
			console.error("Error adding current segment:", (event.target as IDBRequest).error)
		}
	}

	// Function to add the time for each frame when they are written to the stream in IndexedDB
	static addFrameToStreamTimestamp(
		frameTimestamp: number,
		frameData: Uint8Array,
		frameType: string,
		currentDateTime: number,
		segmentID: number,
		frameId: number,
	) {
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
				_2_encodingTime: currentDateTime - currentFrame._1_rawVideoTimestamp,
				_3_segmentationTimestamp: currentDateTime,
				_10_encodedTimestampAttribute: frameTimestamp,
				_13_sentBytes: frameData.byteLength - 108, // 108 bytes are somehow added along the path but not received
				_15_sentType: frameType,
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

	// Function to add the receive timestamp for each segment to the IndexedDB
	static receiveSegment(segmentID: number, currentDateTime: number) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.SEGMENTS, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.SEGMENTS)
		const updateRequest = objectStore.get(segmentID)

		// Handle the success event when the current value is retrieved successfully
		updateRequest.onsuccess = (event) => {
			const currentSegment: IndexedDBSegmentsSchema = (event.target as IDBRequest).result ?? {} // Retrieve the current value

			const updatedSegment = {
				...currentSegment,
				propagationTime: currentDateTime - currentSegment.sentTimestamp,
				receivedTimestamp: currentDateTime,
			} as IndexedDBSegmentsSchema

			const putRequest = objectStore.put(updatedSegment, segmentID) // Store the updated value back into the database

			// Handle the success event when the updated value is stored successfully
			putRequest.onsuccess = () => {
				// console.log("Segment updated successfully. New value:", updatedSegment)
			}

			// Handle any errors that occur during value storage
			putRequest.onerror = (event) => {
				console.error("Error storing updated value:", (event.target as IDBRequest).error)
			}
		}

		// Handle any errors that occur during value retrieval
		updateRequest.onerror = (event) => {
			console.error("Error updating segment:", (event.target as IDBRequest).error)
		}
	}

	// Function to add the decode timestamp of a frame in IndexedDB
	static addReceiveMP4FrameTimestamp(
		frameID: number,
		frameDts: number,
		frameSize: number,
		isKeyFrame: boolean,
		frameWidth: number,
		frameHeight: number,
		currentTimeInMilliseconds: number,
	) {
		if (!db) {
			// console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
		const updateRequest = objectStore.get(frameID)

		// Handle the success event when the current value is retrieved successfully
		updateRequest.onsuccess = (event) => {
			const currentFrame: IndexedDBFramesSchema = (event.target as IDBRequest).result ?? {} // Retrieve the current value (default to 0 if not found)
			// console.log("CURRENT_FRAME", frameID, currentFrame)

			const updatedFrame = {
				...currentFrame,
				_4_propagationTime: currentTimeInMilliseconds - currentFrame._3_segmentationTimestamp,
				_5_receiveMp4FrameTimestamp: currentTimeInMilliseconds,
				_11_decodedTimestampAttribute: frameDts,
				_14_receivedBytes: frameSize,
				_16_receivedType: isKeyFrame ? "key" : "delta",
				_17_width: frameWidth,
				_18_height: frameHeight,
			} as IndexedDBFramesSchema // Calculate the updated value

			const putRequest = objectStore.put(updatedFrame, frameID) // Store the updated value back into the database

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

	// Function to add the render timestamp of a frame in IndexedDB
	static addRenderFrameTimestamp(frame: VideoFrame, currentTimeInMilliseconds: number) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
		if (frame.duration) {
			const updateRequest = objectStore.get(frame.duration)

			// Handle the success event when the current value is retrieved successfully
			updateRequest.onsuccess = (event) => {
				const currentFrame: IndexedDBFramesSchema = (event.target as IDBRequest).result ?? {} // Retrieve the current value (default to 0 if not found)
				// console.log("CURRENT_FRAME", frame.sample.duration, currentFrame)

				const updatedFrame = {
					...currentFrame,
					_6_decodingTime: currentTimeInMilliseconds - currentFrame._5_receiveMp4FrameTimestamp,
					_7_renderFrameTimestamp: currentTimeInMilliseconds,
					_8_totalTime: currentTimeInMilliseconds - currentFrame._1_rawVideoTimestamp,
					_12_renderTimestampAttribute: frame.timestamp,
				} as IndexedDBFramesSchema

				const putRequest = objectStore.put(updatedFrame, frame.duration!) // Store the updated value back into the database

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
	}

	// Function to retrieve all segment data from IndexedDB
	static retrieveSegmentsFromIndexedDB(): Promise<IndexedDBSegmentsSchema[]> {
		return new Promise((resolve, reject) => {
			if (!db) {
				reject(new Error("IndexedDB is not initialized."))
				return
			}

			const transaction = db.transaction(IndexedDBObjectStores.SEGMENTS, "readonly")
			const objectStore = transaction.objectStore(IndexedDBObjectStores.SEGMENTS)
			const getRequest = objectStore.getAll() // Get all stored values from the database

			// Handle the success event when the values are retrieved successfully
			getRequest.onsuccess = (event) => {
				const storedValues = (event.target as IDBRequest).result as IndexedDBSegmentsSchema[]
				resolve(storedValues)
			}

			// Handle any errors that occur during value retrieval
			getRequest.onerror = (event) => {
				console.error("Error retrieving value:", (event.target as IDBRequest).error)
				reject((event.target as IDBRequest).error)
			}
		})
	}

	// Function to retrieve all frame data from IndexedDB
	static retrieveFramesFromIndexedDB(): Promise<IndexedDBFramesSchema[]> {
		return new Promise((resolve, reject) => {
			if (!db) {
				reject(new Error("IndexedDB is not initialized."))
				return
			}

			const transaction = db.transaction(IndexedDBObjectStores.FRAMES, "readonly")
			const objectStore = transaction.objectStore(IndexedDBObjectStores.FRAMES)
			const getRequest = objectStore.getAll() // Get all stored values from the database

			// Handle the success event when the values are retrieved successfully
			getRequest.onsuccess = (event) => {
				const storedValues = (event.target as IDBRequest).result as IndexedDBFramesSchema[]
				resolve(storedValues)
			}

			// Handle any errors that occur during value retrieval
			getRequest.onerror = (event) => {
				console.error("Error retrieving value:", (event.target as IDBRequest).error)
				reject((event.target as IDBRequest).error)
			}
		})
	}

	// Function to get the start time of the stream in IndexedDB
	static getStreamStartTime(): Promise<number> {
		return new Promise((resolve, reject) => {
			if (!db) {
				console.error("IndexedDB is not initialized.")
				return
			}

			const transaction = db.transaction(IndexedDBObjectStores.START_STREAM_TIME, "readonly")
			const objectStore = transaction.objectStore(IndexedDBObjectStores.START_STREAM_TIME)
			const getRequest = objectStore.get(1)

			// Handle the success event when the updated value is retrieved successfully
			getRequest.onsuccess = (event) => {
				const startTime = (event.target as IDBRequest).result as number
				// console.log("Start time successfully retrieved:", startTime)
				resolve(startTime)
			}

			// Handle any errors that occur during value retrieval
			getRequest.onerror = (event) => {
				console.error("Error retrieving start time:", (event.target as IDBRequest).error)
				reject((event.target as IDBRequest).error)
			}
		})
	}

	// Function to adjust the key frame interval size in IndexedDB
	static adjustKeyFrameIntervalSizeInIndexedDB(keyFrameIntervalSize: number) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.KEY_FRAME_INTERVAL_SIZE, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.KEY_FRAME_INTERVAL_SIZE)
		const addRequest = objectStore.put(keyFrameIntervalSize, 0)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Key frame interval size successfully set:", keyFrameIntervalSize)
		}

		// Handle any errors that occur during value storage
		addRequest.onerror = (event) => {
			console.error("Error adding key frame interval size:", (event.target as IDBRequest).error)
		}
	}

	// Function to change the bitrate mode in IndexedDB
	static changeBitrateMode(bitrateMode: BitrateMode) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.BITRATE_OPTIONS, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.BITRATE_OPTIONS)
		const addRequest = objectStore.put(bitrateMode, 0)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Value successfully set:", bitrateMode)
		}

		// Handle any errors that occur during value storage
		addRequest.onerror = (event) => {
			console.error("Error adding value:", (event.target as IDBRequest).error)
		}
	}

	// Function to change the bitrate in IndexedDB
	static changeBitrate(bitrate: number) {
		if (!db) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = db.transaction(IndexedDBObjectStores.BITRATE_OPTIONS, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStores.BITRATE_OPTIONS)
		const addRequest = objectStore.put(bitrate, 1)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Value successfully set:", bitrate)
		}

		// Handle any errors that occur during value storage
		addRequest.onerror = (event) => {
			console.error("Error adding value:", (event.target as IDBRequest).error)
		}
	}

	// Function to retrieve the bitrate mode and bitrate from IndexedDB
	static retrieveBitrateSettings(): Promise<BitrateOptions> {
		return new Promise((resolve, reject) => {
			if (!db) {
				console.error("IndexedDB is not initialized.")
				return
			}

			const transaction = db.transaction(IndexedDBObjectStores.BITRATE_OPTIONS, "readonly")
			const objectStore = transaction.objectStore(IndexedDBObjectStores.BITRATE_OPTIONS)
			const getRequest = objectStore.getAll()

			// Handle the success event when the updated value is retrieved successfully
			getRequest.onsuccess = (event) => {
				const bitrateOptionsArray = (event.target as IDBRequest).result
				// console.log("Value successfully retrieved:", keyFrameIntervalSize)
				const bitrateOptions: BitrateOptions = {
					bitrateMode: bitrateOptionsArray[0],
					bitrate: bitrateOptionsArray[1],
				}
				resolve(bitrateOptions)
			}

			// Handle any errors that occur during value retrieval
			getRequest.onerror = (event) => {
				console.error("Error retrieving value:", (event.target as IDBRequest).error)
				reject((event.target as IDBRequest).error)
			}
		})
	}

	// Function to add received segments to the IndexedDB
	static addSegmentsSubscriber(segments: IndexedDBSegmentsSchemaSubscriber[]) {
		if (!subscriberDB) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = subscriberDB.transaction(IndexedDBObjectStoresSubscriber.SEGMENTS, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStoresSubscriber.SEGMENTS)
		const addRequest = objectStore.put(segments, 1)

		// Handle the success event when the updated value is stored successfully
		addRequest.onsuccess = () => {
			// console.log("Segments successfully set:", currentTimeInMilliseconds)
		}

		// Handle any errors that occur during value storage
		addRequest.onerror = (event) => {
			console.error("Error adding segments:", (event.target as IDBRequest).error)
		}
	}

	// Function to add received frames to the IndexedDB
	static addFramesSubscriber(frames: IndexedDBFramesSchemaSubscriber[]) {
		if (!subscriberDB) {
			console.error("IndexedDB is not initialized.")
			return
		}

		const transaction = subscriberDB.transaction(IndexedDBObjectStoresSubscriber.FRAMES, "readwrite")
		const objectStore = transaction.objectStore(IndexedDBObjectStoresSubscriber.FRAMES)
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

	// Function to retrieve all frame data from IndexedDB
	static retrieveFramesFromIndexedDBSubscriber(): Promise<IndexedDBFramesSchemaSubscriber[]> {
		return new Promise((resolve, reject) => {
			if (!subscriberDB) {
				reject(new Error("IndexedDB is not initialized."))
				return
			}

			const transaction = subscriberDB.transaction(IndexedDBObjectStoresSubscriber.FRAMES, "readonly")
			const objectStore = transaction.objectStore(IndexedDBObjectStoresSubscriber.FRAMES)
			const getRequest = objectStore.get(1) // Get all stored values from the database

			// Handle the success event when the values are retrieved successfully
			getRequest.onsuccess = (event) => {
				const storedValues = (event.target as IDBRequest).result as IndexedDBFramesSchemaSubscriber[]
				resolve(storedValues)
			}

			// Handle any errors that occur during value retrieval
			getRequest.onerror = (event) => {
				console.error("Error retrieving value:", (event.target as IDBRequest).error)
				reject((event.target as IDBRequest).error)
			}
		})
	}

	// Function to retrieve all segment data from IndexedDB
	static retrieveSegmentsFromIndexedDBSubscriber(): Promise<IndexedDBSegmentsSchemaSubscriber[]> {
		return new Promise((resolve, reject) => {
			if (!subscriberDB) {
				reject(new Error("IndexedDB is not initialized."))
				return
			}

			const transaction = subscriberDB.transaction(IndexedDBObjectStoresSubscriber.SEGMENTS, "readonly")
			const objectStore = transaction.objectStore(IndexedDBObjectStoresSubscriber.SEGMENTS)
			const getRequest = objectStore.get(1) // Get all stored values from the database

			// Handle the success event when the values are retrieved successfully
			getRequest.onsuccess = (event) => {
				const storedValues = (event.target as IDBRequest).result as IndexedDBSegmentsSchemaSubscriber[]
				resolve(storedValues)
			}

			// Handle any errors that occur during value retrieval
			getRequest.onerror = (event) => {
				console.error("Error retrieving value:", (event.target as IDBRequest).error)
				reject((event.target as IDBRequest).error)
			}
		})
	}
}
