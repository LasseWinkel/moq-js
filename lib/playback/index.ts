import * as Message from "./worker/message"

import { Connection } from "../transport/connection"
import { Catalog, isMp4Track, Mp4Track } from "../media/catalog"
import { asError } from "../common/error"

import Backend from "./backend"

import { Client } from "../transport/client"
import { GroupReader } from "../transport/objects"
import { IndexedDBNameSubscriber, IndexedDBObjectStoresSubscriber } from "../contribute"
import { SegmentData } from "../contribute"

let db: IDBDatabase

// Function to initialize the IndexedDB
const initializeIndexedDB = () => {
	if (!db) {
		console.error("IndexedDB is not initialized.")
		return
	}

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
}

// Function to add received segments to the IndexedDB
const addSegments = (segments: SegmentData[]) => {
	if (!db) {
		console.error("IndexedDB is not initialized.")
		return
	}

	const transaction = db.transaction(IndexedDBObjectStoresSubscriber.SEGMENTS, "readwrite")
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

export type Range = Message.Range
export type Timeline = Message.Timeline

export interface PlayerConfig {
	url: string
	namespace: string
	fingerprint?: string // URL to fetch TLS certificate fingerprint
	canvas: HTMLCanvasElement
}

// This class must be created on the main thread due to AudioContext.
export class Player {
	#backend: Backend

	// A periodically updated timeline
	//#timeline = new Watch<Timeline | undefined>(undefined)

	#connection: Connection
	#catalog: Catalog

	// Running is a promise that resolves when the player is closed.
	// #close is called with no error, while #abort is called with an error.
	#running: Promise<void>
	#close!: () => void
	#abort!: (err: Error) => void

	segmentPropagationTimes: SegmentData[] = []

	private constructor(connection: Connection, catalog: Catalog, backend: Backend) {
		// Open IndexedDB
		const openRequest = indexedDB.open(IndexedDBNameSubscriber, 1)

		// Handle the success event when the database is successfully opened
		openRequest.onsuccess = (event) => {
			db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened

			initializeIndexedDB()
		}

		// Handle the upgrade needed event to create or upgrade the database schema
		openRequest.onupgradeneeded = (event) => {
			console.log("UPGRADE_NEEDED")

			db = (event.target as IDBOpenDBRequest).result // Assign db when database is opened
			// Check if the object store already exists
			if (!db.objectStoreNames.contains(IndexedDBObjectStoresSubscriber.SEGMENTS)) {
				// Create an object store (similar to a table in SQL databases)
				db.createObjectStore(IndexedDBObjectStoresSubscriber.SEGMENTS)
			}
			if (!db.objectStoreNames.contains(IndexedDBObjectStoresSubscriber.FRAMES)) {
				db.createObjectStore(IndexedDBObjectStoresSubscriber.FRAMES)
			}
		}

		this.#connection = connection
		this.#catalog = catalog
		this.#backend = backend

		const abort = new Promise<void>((resolve, reject) => {
			this.#close = resolve
			this.#abort = reject
		})

		// Async work
		this.#running = Promise.race([this.#run(), abort]).catch(this.#close)
	}

	static async create(config: PlayerConfig): Promise<Player> {
		const client = new Client({ url: config.url, fingerprint: config.fingerprint, role: "subscriber" })
		const connection = await client.connect()

		const catalog = new Catalog(config.namespace)
		await catalog.fetch(connection)

		const canvas = config.canvas.transferControlToOffscreen()
		const backend = new Backend({ canvas, catalog })

		return new Player(connection, catalog, backend)
	}

	async #run() {
		const inits = new Set<string>()
		const tracks = new Array<Mp4Track>()

		for (const track of this.#catalog.tracks) {
			if (!isMp4Track(track)) {
				throw new Error(`expected CMAF track`)
			}

			inits.add(track.init_track)
			tracks.push(track)
		}

		// Call #runInit on each unique init track
		// TODO do this in parallel with #runTrack to remove a round trip
		await Promise.all(Array.from(inits).map((init) => this.#runInit(init)))

		// Call #runTrack on each track
		await Promise.all(tracks.map((track) => this.#runTrack(track)))
	}

	async #runInit(name: string) {
		const sub = await this.#connection.subscribe(this.#catalog.namespace, name)
		try {
			const init = await Promise.race([sub.data(), this.#running])
			if (!init) throw new Error("no init data")

			// We don't care what type of reader we get, we just want the payload.
			const chunk = await init.read()
			if (!chunk) throw new Error("no init chunk")

			this.#backend.init({ data: chunk.payload, name })
		} finally {
			await sub.close()
		}
	}

	async #runTrack(track: Mp4Track) {
		if (track.kind !== "audio" && track.kind !== "video") {
			throw new Error(`unknown track kind: ${track.kind}`)
		}

		const sub = await this.#connection.subscribe(this.#catalog.namespace, track.data_track)
		try {
			for (;;) {
				const segment = await Promise.race([sub.data(), this.#running])
				if (!segment) break

				if (!(segment instanceof GroupReader)) {
					throw new Error(`expected group reader for segment: ${track.data_track}`)
				}

				this.segmentPropagationTimes.push({
					id: segment.header.group,
					propagationTime: Date.now() - segment.header.priority,
				})

				addSegments(this.segmentPropagationTimes)

				const [buffer, stream] = segment.stream.release()

				this.#backend.segment({
					init: track.init_track,
					kind: track.kind,
					header: segment.header,
					buffer,
					stream,
				})
			}
		} finally {
			await sub.close()
		}
	}

	#onMessage(msg: Message.FromWorker) {
		if (msg.timeline) {
			//this.#timeline.update(msg.timeline)
		}
	}

	async close(err?: Error) {
		if (err) this.#abort(err)
		else this.#close()

		if (this.#connection) this.#connection.close()
		if (this.#backend) await this.#backend.close()
	}

	async closed(): Promise<Error | undefined> {
		try {
			await this.#running
		} catch (e) {
			return asError(e)
		}
	}

	throttle(lossRate: number, delay: number, bandwidthLimit: string, networkNamespace: string) {
		this.#connection.throttle(lossRate, delay, bandwidthLimit, networkNamespace)
	}

	packet_loss(lossRate: number) {
		this.#connection.packet_loss(lossRate)
	}

	tc_reset(networkNamespace: string) {
		this.#connection.tc_reset(networkNamespace)
	}

	/*
	play() {
		this.#backend.play({ minBuffer: 0.5 }) // TODO configurable
	}

	seek(timestamp: number) {
		this.#backend.seek({ timestamp })
	}
	*/

	play() {
		void this.#backend.play()
	}

	/*
	async *timeline() {
		for (;;) {
			const [timeline, next] = this.#timeline.value()
			if (timeline) yield timeline
			if (!next) break

			await next
		}
	}
	*/
}
