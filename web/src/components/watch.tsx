/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback"

import { BitrateMode, type IndexedDBFramesSchema, type IndexedDBSegmentsSchemaSubscriber } from "@kixelated/moq/common"
import { IDBService } from "@kixelated/moq/common"

import Plot from "./plotlychart"

import Fail from "./fail"

import { createEffect, createSignal, For, onCleanup } from "solid-js"
import { EVALUATION_SCENARIO, GOP_DEFAULTS } from "@kixelated/moq/common/evaluationscenarios"

// Data update rate in milliseconds
const DATA_UPDATE_RATE = 1000

// The time interval for the latest data in seconds
// const LATEST_DATA_DISPLAY_INTERVAL = 5

// Time until data download in seconds
const DATA_DOWNLOAD_TIME = 80

// Stall event threshold in milliseconds
const STALL_EVENT_THRESHOLD = 34

// The supported rates of network packet loss
// const SUPPORTED_PACKET_LOSS = [0, 1, 5, 10, 20]

// The supported additional network delays in milliseconds
// const SUPPORTED_ADDITIONAL_DELAYS = [0, 20, 50, 100, 200, 500]

// The supported network bandwidth limits in Mbit/s
// const SUPPORTED_BANDWIDTHS = [0.5, 1, 1.5, 2, 3, 4.5, 5, 6, 10, 20, 100]

// The created network namespaces
// enum NetworkNamespaces {
// 	PUBLISHER = "ns-js",
// 	SERVER = "ns-rs",
// }

// Helper function to nicely display large numbers
/* function formatNumber(number: number): string {
	const suffixes = ["", "k", "M", "B", "T"] // Add more suffixes as needed
	const suffixIndex = Math.floor(Math.log10(number) / 3)
	const scaledNumber = number / Math.pow(10, suffixIndex * 3)
	const suffix = suffixes[suffixIndex]
	return scaledNumber.toFixed(2) + suffix
} */

// Helper function to nicely display time strings
function createTimeString(millisecondsInput: number): string {
	const hours = Math.floor(millisecondsInput / 3600000) // 1 hour = 3600000 milliseconds
	const minutes = Math.floor((millisecondsInput % 3600000) / 60000) // 1 minute = 60000 milliseconds
	const seconds = Math.floor((millisecondsInput % 60000) / 1000) // 1 second = 1000 milliseconds
	const milliseconds = Math.floor(millisecondsInput % 1000) // Remaining milliseconds

	// Format the time
	const formattedTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
		seconds,
	).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`

	return formattedTime
}

// Utility function to download collected data.
function downloadFrameData(frames: IndexedDBFramesSchema[]): void {
	const jsonData = JSON.stringify(frames)
	const blob = new Blob([jsonData], {
		type: "application/json",
	})

	const link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	const downloadName = `remotesubscriberres${EVALUATION_SCENARIO.resolution}fps${EVALUATION_SCENARIO.frameRate}bit${
		EVALUATION_SCENARIO.bitrate / 1_000_000
	}gop(${EVALUATION_SCENARIO.gopDefault},${EVALUATION_SCENARIO.gopThresholds[0] * 100},${
		EVALUATION_SCENARIO.gopThresholds[1] * 100
	})loss${EVALUATION_SCENARIO.packetLossServerLink}delay${EVALUATION_SCENARIO.delayServerLink}bw${
		EVALUATION_SCENARIO.bandwidthConstraintServerLink / 1_000_000
	}`
	link.download = downloadName

	// Append the link to the body
	document.body.appendChild(link)

	// Programmatically click the link to trigger the download
	link.click()

	// Clean up
	document.body.removeChild(link)
}

export default function Watch(props: { name: string }) {
	// Use query params to allow overriding environment variables.
	const urlSearchParams = new URLSearchParams(window.location.search)
	const params = Object.fromEntries(urlSearchParams.entries())
	const server = params.server ?? import.meta.env.PUBLIC_RELAY_HOST

	const [error, setError] = createSignal<Error | undefined>()

	// Various dynamic meta data to be displayed next to the video
	const [segmentData, setSegmentData] = createSignal<IndexedDBSegmentsSchemaSubscriber[]>([])
	const [minPropagationTime, setMinPropagationTime] = createSignal<number>(0)
	const [maxPropagationTime, setMaxPropagationTime] = createSignal<number>(0)
	const [avgPropagationTime, setAvgPropagationTime] = createSignal<number>(0)

	const [frameRate, setFrameRate] = createSignal<number>(0)
	const [bitrate, setBitrate] = createSignal<number>(0)
	const [gopSize, setGopSize] = createSignal<number>(0)
	const [targetGopSize, setTargetGopSize] = createSignal<number>(GOP_DEFAULTS[0])
	const [lostFrames, setLostFrames] = createSignal<number>(0)
	const [frameDeliveryRate, setFrameDeliveryRate] = createSignal<number>(0)

	// const [receivedFrames, setReceivedFrames] = createSignal<IndexedDBFramesSchema[]>([])
	const [lastRenderedFrame, setLastRenderedFrame] = createSignal<IndexedDBFramesSchema>()

	const [bitrateMode, setBitrateMode] = createSignal<BitrateMode>(BitrateMode.CONSTANT)
	const [targetBitrate, setTargetBitrate] = createSignal<number>(EVALUATION_SCENARIO.bitrate)

	const [streamWatchTime, setStreamWatchTime] = createSignal<number>(0)

	const [totalStallDuration, setTotalStallDuration] = createSignal<number>(0)
	const [numberOfStallEvents, setNumberOfStallEvents] = createSignal<number>(0)

	/* const [minEncodingTime, setMinEncodingTime] = createSignal<number>(0)
	const [maxEncodingTime, setMaxEncodingTime] = createSignal<number>(0)
	const [avgEncodingTime, setAvgEncodingTime] = createSignal<number>(0.0)
	const [minPropagationTime, setMinPropagationTime] = createSignal<number>(0)
	const [maxPropagationTime, setMaxPropagationTime] = createSignal<number>(0)
	const [avgPropagationTime, setAvgPropagationTime] = createSignal<number>(0.0)
	const [minDecodingTime, setMinDecodingTime] = createSignal<number>(0)
	const [maxDecodingTime, setMaxDecodingTime] = createSignal<number>(0)
	const [avgDecodingTime, setAvgDecodingTime] = createSignal<number>(0.0)
	const [minTotalTime, setMinTotalTime] = createSignal<number>(0)
	const [maxTotalTime, setMaxTotalTime] = createSignal<number>(0)
	const [avgTotalTime, setAvgTotalTime] = createSignal<number>(0.0) */

	/* const [showFramesPlot, setShowFramesPlot] = createSignal<boolean>(false)
	const [showBitratePlot, setShowBitratePlot] = createSignal<boolean>(false)

	const [bitratePlotData, setBitratePlotData] = createSignal<IndexedDBBitRateWithTimestampSchema[]>([]) */

	// const [isRecording, setIsRecording] = createSignal<boolean>(false)

	// Define a function to update the data at regular times
	setInterval(async () => {
		setStreamWatchTime(streamWatchTime() + DATA_UPDATE_RATE)

		const allReceivedSegments = await IDBService.retrieveSegmentsFromIndexedDBSubscriber()

		const totalSegments = allReceivedSegments.length

		const propagationTimes = allReceivedSegments.slice(1).map((segment) => segment.propagationTime)

		const minPropagationTime = Math.min(...propagationTimes)
		const maxPropagationTime = Math.max(...propagationTimes)
		const averagePropagationTime = propagationTimes.reduce((sum, time) => sum + time, 0) / totalSegments

		// Condition to verifiy that the web client is used as publisher instead of moq-pub, i.e., ffmpeg
		const publisherIsWebClient = averagePropagationTime < 1_000_000_000

		setSegmentData(allReceivedSegments)
		if (publisherIsWebClient) {
			setMinPropagationTime(minPropagationTime)
			setMaxPropagationTime(maxPropagationTime)
			setAvgPropagationTime(averagePropagationTime)
		}

		const allReceivedFrames = (await IDBService.retrieveFramesFromIndexedDBSubscriber()).filter(
			(aFrame) => aFrame._5_receiveMp4FrameTimestamp !== undefined,
		)

		const allRenderedFrames = allReceivedFrames.filter((aFrame) => aFrame._7_renderFrameTimestamp !== undefined)

		let newTotalStallDuration = 0
		let newNumberOfStallEvents = 0

		for (let i = 0; i < allRenderedFrames.length - 1; i++) {
			const currentTimestamp = allRenderedFrames[i]._7_renderFrameTimestamp
			const nextTimestamp = allRenderedFrames[i + 1]._7_renderFrameTimestamp
			const difference = nextTimestamp - currentTimestamp

			if (difference > STALL_EVENT_THRESHOLD) {
				newTotalStallDuration += difference - STALL_EVENT_THRESHOLD
				newNumberOfStallEvents++
			}
		}

		setTotalStallDuration(newTotalStallDuration)
		setNumberOfStallEvents(newNumberOfStallEvents)

		const metrics = {
			frameRate: 0,
			bitrate: 0,
			avgGopSize: 0,
			lostFrames: 0,
			frameDeliverRate: 0,
		}

		let totalSize = 0
		let totalDuration = 0
		let keyFrameCount = 0
		// let totalGopSize = 0
		let lastFrameId = allReceivedFrames[0]._0_frameId
		// let lastKeyFrameIndex = -1

		for (let i = 0; i < allReceivedFrames.length; i++) {
			const frame = allReceivedFrames[i]
			totalSize += frame._14_receivedBytes

			if (i > 0) {
				const duration =
					frame._5_receiveMp4FrameTimestamp - allReceivedFrames[i - 1]._5_receiveMp4FrameTimestamp
				totalDuration += duration

				// Detect frame loss
				if (frame._0_frameId !== lastFrameId + 1) {
					metrics.lostFrames += frame._0_frameId - lastFrameId - 1
				}
			}

			// GoP size calculation
			if (frame._16_receivedType === "key") {
				/* if (lastKeyFrameIndex !== -1) {
					totalGopSize += i - lastKeyFrameIndex
				}
				lastKeyFrameIndex = i */
				keyFrameCount++
			}

			lastFrameId = frame._0_frameId
		}

		const totalTimeInSeconds = totalDuration / 1000

		const numberOfSentFrames =
			allReceivedFrames[allReceivedFrames.length - 1]._0_frameId - allReceivedFrames[0]._0_frameId + 1

		// Frame rate calculation
		metrics.frameRate = allReceivedFrames.length / totalTimeInSeconds

		// Bitrate calculation (size in bits, time in seconds)
		metrics.bitrate = (totalSize * 8) / totalTimeInSeconds / 1_000_000

		// Average GoP size calculation
		// metrics.avgGopSize = keyFrameCount > 1 ? totalGopSize / (keyFrameCount - 1) : 0
		metrics.avgGopSize = keyFrameCount > 1 ? totalTimeInSeconds / (keyFrameCount - 1) : 0

		metrics.frameDeliverRate = Math.min(allReceivedFrames.length / numberOfSentFrames, 1) * 100

		setFrameRate(metrics.frameRate)
		setBitrate(metrics.bitrate)
		setGopSize(metrics.avgGopSize)
		if (publisherIsWebClient) {
			setLostFrames(metrics.lostFrames)
		}
		setFrameDeliveryRate(metrics.frameDeliverRate)
		setLastRenderedFrame(allReceivedFrames[allReceivedFrames.length - 1])
	}, DATA_UPDATE_RATE)

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	createEffect(() => {
		IDBService.initIDBServiceSubscriber()
		setTimeout(() => {
			IDBService.resetIndexedDBSubscriber()
		}, 100)

		setTimeout(async () => {
			downloadFrameData(
				(await IDBService.retrieveFramesFromIndexedDBSubscriber()).filter(
					(aFrame) => aFrame._5_receiveMp4FrameTimestamp !== undefined,
				),
			)
		}, DATA_DOWNLOAD_TIME * 1000)

		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("14.0.0.1") ? `https://${server}/fingerprint` : undefined

		Player.create({ url, fingerprint, canvas, namespace }).then(setPlayer).catch(setError)
	})

	createEffect(() => {
		const player = usePlayer()
		if (!player) return

		onCleanup(() => {
			player.close().then(setError).catch(setError)
			// clearInterval(updateDataInterval)
		})
		player.closed().then(setError).catch(setError)
	})

	const play = () => usePlayer()?.play()

	const setServerStoredMetrics = () => {
		usePlayer()?.setServerStoredMetrics(targetGopSize().toString(), bitrateMode(), targetBitrate())
	}

	// NOTE: The canvas automatically has width/height set to the decoded video size.
	// TODO shrink it if needed via CSS
	return (
		<div class="flex">
			<div class="flex w-1/2 flex-col items-center">
				<Fail error={error()} />

				{/* {isRecording() && <div class="text-red-400">Recording</div>} */}
				<span>
					{lastRenderedFrame()?._17_width} x {lastRenderedFrame()?._18_height}
				</span>
				<canvas ref={canvas} onClick={play} class="aspect-video w-3/4 rounded-lg" />

				<div class="flex items-center">
					<span>Watch time: &nbsp;</span>
					<p>{createTimeString(streamWatchTime())}</p>
				</div>

				{/* {<h3>Charts</h3>}

				<button onClick={() => setShowFramesPlot(!showFramesPlot())}>Toggle Frames Plot</button>
				<button onClick={() => setShowBitratePlot(!showBitratePlot())}>Toggle Bitrate Plot</button>

				{showFramesPlot() && <FramesPlot watchStartTime={streamStartWatchTime()} frames={latestFrames()} />}
				{showBitratePlot() && <BitratePlot bitrateWithTimestamp={bitratePlotData()} />}

				*/}

				{/* <div class="flex">
					<div class="mr-20 flex items-center">
						<span>Stream live since: &nbsp;</span>
						<p>{createTimeString(streamRunningTime())}</p>
					</div>

					<div class="flex items-center">
						<span>Watching since: &nbsp;</span>
						<p>{createTimeString(streamWatchTime())}</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>Total Frames Skipped: &nbsp;</span>
						<p>{totalSkippedFrames().length}</p>
					</div>
					<div class="flex items-center">
						<span>Total Stall Duration: &nbsp;</span>
						<p>{(totalStallDuration() / 1000).toFixed(2)}s</p>
					</div>
				</div>

				<div class="w-full">
					<div class="flex items-center">
						<span>Key Frame Interval (s): &nbsp;</span>
						<select
							class="m-3 w-1/3"
							onChange={(event) => {
								setConstantGopSize(true)
								setKeyFrameInterval(parseFloat(event.target.value))
								IDBService.adjustKeyFrameIntervalSizeInIndexedDB(parseFloat(event.target.value))
							}}
						>
							<For each={GOP_DEFAULTS}>
								{(value) => (
									<option value={value} selected={value === keyFrameInterval()}>
										{value}
									</option>
								)}
							</For>
						</select>
					</div>

					<div class="flex items-center">
						GoP size 1s Received Frames:
						<input
							class="m-3 w-1/3"
							type="range"
							min="15"
							max="95"
							value={gop1sThreshold()}
							onChange={(event) => {
								const value = parseInt(event.target.value, 10)
								setGop1sThreshold(value)
							}}
						/>
						<div class="mt-2 text-center">{gop1sThreshold()}%</div>
					</div>

					<div class="flex items-center">
						GoP size 0.5s Received Frames:
						<input
							class="m-3 w-1/3"
							type="range"
							min="10"
							max="90"
							value={gop0_5sThreshold()}
							onChange={(event) => {
								const value = parseInt(event.target.value, 10)
								setGop0_5sThreshold(value)
							}}
						/>
						<div class="mt-2 text-center">{gop0_5sThreshold()}%</div>
					</div>

					<div class="flex items-center">
						<div class="mr-5 w-1/2 border p-2">
							<h3>Publisher Network</h3>
							<div class="flex items-center">
								Packet Loss (%):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setPacketLossPublisher(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.PUBLISHER)
									}}
								>
									<For each={SUPPORTED_PACKET_LOSS}>
										{(value) => (
											<option value={value} selected={value === packetLossPublisher()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Network Delay (ms):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setDelayPublisher(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.PUBLISHER)
									}}
								>
									<For each={SUPPORTED_ADDITIONAL_DELAYS}>
										{(value) => (
											<option value={value} selected={value === delayPublisher()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Bandwidth Limit (Mbit/s):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setBandwidthLimitPublisher(parseFloat(event.target.value))
										throttleConnection(NetworkNamespaces.PUBLISHER)
									}}
								>
									<For each={SUPPORTED_BANDWIDTHS}>
										{(value) => (
											<option value={value} selected={value === bandwidthLimitPublisher()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<button
								class="m-3 bg-cyan-600 hover:bg-cyan-800"
								onClick={() => {
									tc_reset(NetworkNamespaces.PUBLISHER)
									setPacketLossPublisher(0)
									setDelayPublisher(0)
									setBandwidthLimitPublisher(SUPPORTED_BANDWIDTHS[SUPPORTED_BANDWIDTHS.length - 1])
								}}
							>
								Reset tc rules
							</button>
						</div>

						<div class="w-1/2 border p-2">
							<h3>Server Network</h3>
							<div class="flex items-center">
								Packet Loss (%):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setPacketLossServer(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.SERVER)
									}}
								>
									<For each={SUPPORTED_PACKET_LOSS}>
										{(value) => (
											<option value={value} selected={value === packetLossServer()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Network Delay (ms):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setDelayServer(parseInt(event.target.value))
										throttleConnection(NetworkNamespaces.SERVER)
									}}
								>
									<For each={SUPPORTED_ADDITIONAL_DELAYS}>
										{(value) => (
											<option value={value} selected={value === delayServer()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<div class="flex items-center">
								Bandwidth Limit (Mbit/s):
								<select
									class="m-3 w-1/3"
									onChange={(event) => {
										setBandwidthLimitServer(parseFloat(event.target.value))
										throttleConnection(NetworkNamespaces.SERVER)
									}}
								>
									<For each={SUPPORTED_BANDWIDTHS}>
										{(value) => (
											<option value={value} selected={value === bandwidthLimitServer()}>
												{value}
											</option>
										)}
									</For>
								</select>
							</div>
							<button
								class="m-3 bg-cyan-600 hover:bg-cyan-800"
								onClick={() => {
									tc_reset(NetworkNamespaces.SERVER)
									setPacketLossServer(0)
									setDelayServer(0)
									setBandwidthLimitServer(SUPPORTED_BANDWIDTHS[SUPPORTED_BANDWIDTHS.length - 1])
								}}
							>
								Reset tc rules
							</button>
						</div>
					</div>
				</div>
 */}
				{/* <div class="flex w-1/2 flex-col items-center justify-center">
					<button
						class="m-3 bg-cyan-600 hover:bg-cyan-800"
						// eslint-disable-next-line @typescript-eslint/no-misused-promises
						onClick={async () => downloadFrameData(await retrieveFramesFromIndexedDB())}
					>
						Download data
					</button>
				</div> */}
				{<h3>Segment Data</h3>}

				<div class="flex ">
					<div class="mr-20 flex items-center">
						<span>Total segments: &nbsp;</span>
						<p>{segmentData().length}</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>Propagation Time (min | max | avg): &nbsp;</span>
						<span>{minPropagationTime()} ms | &nbsp;</span>
						<span>{maxPropagationTime()} ms | &nbsp;</span>
						<span>{avgPropagationTime().toFixed(2)} ms&nbsp;</span>
					</div>
				</div>

				<Plot segments={segmentData().slice(1)} />
			</div>

			{/*

			<div class="grid grid-cols-4 gap-5 border">
				<div class="p-5 text-center" />
				<div class="p-5 text-center">Min</div>
				<div class="p-5 text-center">Max</div>
				<div class="p-5 text-center">Avg</div>

				<div class="p-5 text-center">Encoding Time:</div>
				<div class="p-5 text-center">{minEncodingTime()}</div>
				<div class="p-5 text-center">{maxEncodingTime()}</div>
				<div class="p-5 text-center">{avgEncodingTime().toFixed(2)}</div>

				<div class="p-5 text-center">Propagation Time:</div>
				<div class="p-5 text-center">{minPropagationTime()}</div>
				<div class="p-5 text-center">{maxPropagationTime()}</div>
				<div class="p-5 text-center">{avgPropagationTime().toFixed(2)}</div>

				<div class="p-5 text-center">Render Time:</div>
				<div class="p-5 text-center">{minDecodingTime()}</div>
				<div class="p-5 text-center">{maxDecodingTime()}</div>
				<div class="p-5 text-center">{avgDecodingTime().toFixed(2)}</div>

				<div class="p-5 text-center">Total Time:</div>
				<div class="p-5 text-center">{minTotalTime()}</div>
				<div class="p-5 text-center">{maxTotalTime()}</div>
				<div class="p-5 text-center">{avgTotalTime().toFixed(2)}</div>
			</div>
			*/}

			{/* <div class="flex w-1/2 flex-col items-center">
				<h3>Meta Data of Last {LATEST_DATA_DISPLAY_INTERVAL} Seconds</h3>

				<div class="grid grid-cols-5 gap-6 border">
					<div class="p-4 text-center" />
					<div class="p-4 text-center">Min</div>
					<div class="p-4 text-center">Max</div>
					<div class="p-4 text-center">Last</div>
					<div class="p-4 text-center">Avg</div>

					<div class="p-4 text-center">Encoding Time:</div>
					<div class="p-4 text-center">{minLatestEncodingTime()} ms</div>
					<div class="p-4 text-center">{maxLatestEncodingTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFrameEncodingTime()} ms</div>
					<div class="p-4 text-center">{avgLatestEncodingTime().toFixed(2)} ms</div>

					<div class="p-4 text-center">Propagation Time:</div>
					<div class="p-4 text-center">{minLatestPropagationTime()} ms</div>
					<div class="p-4 text-center">{maxLatestPropagationTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFramePropagationTime()} ms</div>
					<div class="p-4 text-center">{avgLatestPropagationTime().toFixed(2)} ms</div>

					<div class="p-4 text-center">Decoding Time:</div>
					<div class="p-4 text-center">{minLatestDecodingTime()} ms</div>
					<div class="p-4 text-center">{maxLatestDecodingTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFrameDecodingTime()} ms</div>
					<div class="p-4 text-center">{avgLatestDecodingTime().toFixed(2)} ms</div>

					<div class="p-4 text-center">Total Time:</div>
					<div class="p-4 text-center">{minLatestTotalTime()} ms</div>
					<div class="p-4 text-center">{maxLatestTotalTime()} ms</div>
					<div class="p-4 text-center">{lastRenderedFrameTotalTime()} ms</div>
					<div class="p-4 text-center">{avgLatestTotalTime().toFixed(2)} ms</div>
				</div>

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>Bits Received: &nbsp;</span>
						<p>{formatNumber(totalAmountRecvBytes() * 8)}</p>
					</div>

					<div class="mr-20 flex items-center">
						<span>Bitrate: &nbsp;</span>
						<p>{formatNumber(bitRate())} bps</p>
					</div>

					<div class="flex items-center">
						<span>Frame Rate: &nbsp;</span>
						<p>{framesPerSecond()} fps</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-14 flex items-center">
						<span>Total Frames Received: &nbsp;</span>
						<p>{receivedFrames().length}</p>
					</div>

					<div class="mr-14 flex items-center">
						<span>Percentage of Frames Received: &nbsp;</span>
						<p>{(percentageReceivedFrames() * 100).toFixed(2)}%</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>Latest Frames Skipped: &nbsp;</span>
						<p>{latestSkippedFrames().length}</p>
					</div>
					<div class="flex items-center">
						<span>Latest Stall Duration: &nbsp;</span>
						<p>{(latestStallDuration() / 1000).toFixed(2)}s</p>
					</div>
				</div>
			</div> */}
			<div class="flex w-1/2 flex-col items-center">
				<h3>Frame Data</h3>

				<div class="flex">
					<div class="mr-14 flex items-center">
						<span>Frame Rate: &nbsp;</span>
						<p>{frameRate().toFixed(2)} Fps</p>
					</div>

					<div class="mr-14 flex items-center">
						<span>Bitrate: &nbsp;</span>
						<p>{bitrate().toFixed(2)} Mbps</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-14 flex items-center">
						<span>Dropped Frames: &nbsp;</span>
						<p>{lostFrames()}</p>
					</div>

					<div class="mr-14 flex items-center">
						<span>Frame Delivery Rate: &nbsp;</span>
						<p>{frameDeliveryRate().toFixed(2)} %</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-14 flex items-center">
						<span>Number of Stall Events: &nbsp;</span>
						<p>{numberOfStallEvents()}</p>
					</div>
					<div class="flex items-center">
						<span>Total Stall Duration: &nbsp;</span>
						<p>{(totalStallDuration() / 1000).toFixed(3)}s</p>
					</div>
				</div>

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>GoP Size: &nbsp;</span>
						<p>{gopSize().toFixed(2)}</p>
					</div>
				</div>

				<div class="flex w-1/2 items-center">
					<span>Target GoP Size (s): &nbsp;</span>
					<select
						class="w-1/3"
						onChange={(event) => {
							setTargetGopSize(parseFloat(event.target.value))
							setServerStoredMetrics()
						}}
					>
						<For each={GOP_DEFAULTS}>
							{(value) => (
								<option value={value} selected={value === targetGopSize()}>
									{value}
								</option>
							)}
						</For>
					</select>
				</div>

				<div class="flex w-1/2 items-center">
					<span>Bitrate Mode: &nbsp;</span>
					<select
						class="m-3 w-1/3"
						onChange={(event) => {
							setBitrateMode(event.target.value as BitrateMode)
							setServerStoredMetrics()
						}}
					>
						<For each={Object.values(BitrateMode)}>
							{(value) => (
								<option value={value} selected={value === bitrateMode()}>
									{value}
								</option>
							)}
						</For>
					</select>
				</div>

				<div class="flex items-center">
					Bitrate: &nbsp;<span class="text-slate-400">{(targetBitrate() / 1_000_000).toFixed(1)} Mb/s</span>
					<input
						disabled={bitrateMode() === BitrateMode.CONSTANT}
						class="m-3"
						type="range"
						min={500_000}
						max={20_000_000}
						value={targetBitrate()}
						onChange={(event) => {
							const value = parseInt(event.target.value, 10)
							setTargetBitrate(value)
							setServerStoredMetrics()
						}}
					/>
				</div>
			</div>
		</div>
	)
}
