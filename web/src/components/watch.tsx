/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback"

import { BitrateMode, type IndexedDBFramesSchema, type IndexedDBSegmentsSchemaSubscriber } from "@kixelated/moq/common"
import { IDBService } from "@kixelated/moq/common"

import Plot from "./plotlychart"

import Fail from "./fail"

import { createEffect, createSignal, For, onCleanup } from "solid-js"
import { EVALUATION_SCENARIO, GOP_DEFAULTS } from "@kixelated/moq/common/evaluationscenarios"

import config from "../../../config.json"

// Data update rate in milliseconds
const DATA_UPDATE_RATE = 1000

// The time interval for the latest data in seconds
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const LATEST_DATA_DISPLAY_INTERVAL = config.timeIntervalOfLatestDataInSeconds

// Time until data download in seconds
const DATA_DOWNLOAD_TIME = 80

// Stall event threshold in milliseconds
const STALL_EVENT_THRESHOLD = 34

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
		EVALUATION_SCENARIO.bandwidthConstraintServerLink
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
	const server = params.server ?? `${config.serverIpAddressForRemoteSubscriber}:${config.serverPort}`

	const [error, setError] = createSignal<Error | undefined>()

	// Condition to verifiy that the web client is used as publisher instead of moq-pub, i.e., ffmpeg
	const [publisherIsWebClient, setPublisherIsWebClient] = createSignal<boolean>(true)
	const [displayLatestDataOnly, setDisplayLatestDataOnly] = createSignal<boolean>(false)

	// Various dynamic meta data to be displayed next to the video
	const [segmentData, setSegmentData] = createSignal<IndexedDBSegmentsSchemaSubscriber[]>([])
	const [minPropagationTime, setMinPropagationTime] = createSignal<number>(0)
	const [maxPropagationTime, setMaxPropagationTime] = createSignal<number>(0)
	const [avgPropagationTime, setAvgPropagationTime] = createSignal<number>(0)

	const [minDecodingTime, setMinDecodingTime] = createSignal<number>(0)
	const [maxDecodingTime, setMaxDecodingTime] = createSignal<number>(0)
	const [avgDecodingTime, setAvgDecodingTime] = createSignal<number>(0)

	const [frameRate, setFrameRate] = createSignal<number>(0)
	const [bitrate, setBitrate] = createSignal<number>(0)
	const [gopSize, setGopSize] = createSignal<number>(0)
	const [targetGopSize, setTargetGopSize] = createSignal<number>(GOP_DEFAULTS[0])
	const [gop1sThreshold, setGop1sThreshold] = createSignal<number>(EVALUATION_SCENARIO.gopThresholds[0] * 100)
	const [gop0_5sThreshold, setGop0_5sThreshold] = createSignal<number>(EVALUATION_SCENARIO.gopThresholds[1] * 100)
	const [constantGopSize, setConstantGopSize] = createSignal<boolean>(false)
	const [lostFrames, setLostFrames] = createSignal<number>(0)
	const [frameDeliveryRate, setFrameDeliveryRate] = createSignal<number>(0)

	const [lastRenderedFrame, setLastRenderedFrame] = createSignal<IndexedDBFramesSchema>()

	const [bitrateMode, setBitrateMode] = createSignal<BitrateMode>(BitrateMode.CONSTANT)
	const [targetBitrate, setTargetBitrate] = createSignal<number>(EVALUATION_SCENARIO.bitrate)

	const [streamWatchTime, setStreamWatchTime] = createSignal<number>(0)

	const [totalStallDuration, setTotalStallDuration] = createSignal<number>(0)
	const [numberOfStallEvents, setNumberOfStallEvents] = createSignal<number>(0)

	// Define a function to update the data at regular times
	setInterval(async () => {
		setStreamWatchTime(streamWatchTime() + DATA_UPDATE_RATE)

		const allReceivedSegments = displayLatestDataOnly()
			? (await IDBService.retrieveSegmentsFromIndexedDBSubscriber()).filter(
					(aSegment) => Date.now() - aSegment.receiveTime <= LATEST_DATA_DISPLAY_INTERVAL * 1000,
			  )
			: await IDBService.retrieveSegmentsFromIndexedDBSubscriber()

		const propagationTimes = allReceivedSegments.slice(1).map((segment) => segment.propagationTime)

		const minPropagationTime = Math.min(...propagationTimes)
		const maxPropagationTime = Math.max(...propagationTimes)
		const averagePropagationTime = propagationTimes.reduce((sum, time) => sum + time, 0) / propagationTimes.length

		const publisherIsWebClient = averagePropagationTime < 1_000_000_000
		setPublisherIsWebClient(publisherIsWebClient)

		setSegmentData(allReceivedSegments)
		if (publisherIsWebClient) {
			setMinPropagationTime(minPropagationTime)
			setMaxPropagationTime(maxPropagationTime)
			setAvgPropagationTime(averagePropagationTime)
		}

		const allReceivedFrames = displayLatestDataOnly()
			? (await IDBService.retrieveFramesFromIndexedDBSubscriber()).filter(
					(aFrame) =>
						aFrame._5_receiveMp4FrameTimestamp !== undefined &&
						Date.now() - aFrame._5_receiveMp4FrameTimestamp <= LATEST_DATA_DISPLAY_INTERVAL * 1000,
			  )
			: (await IDBService.retrieveFramesFromIndexedDBSubscriber()).filter(
					(aFrame) => aFrame._5_receiveMp4FrameTimestamp !== undefined,
			  )

		const allRenderedFrames = allReceivedFrames.filter((aFrame) => aFrame._7_renderFrameTimestamp !== undefined)

		const decodingTimes = allRenderedFrames.map((aFrame) => aFrame._6_decodingTime)

		const minDecodingTime = Math.min(...decodingTimes)
		const maxDecodingTime = Math.max(...decodingTimes)
		const averageDecodingTime = decodingTimes.reduce((sum, time) => sum + time, 0) / decodingTimes.length

		setMinDecodingTime(minDecodingTime)
		setMaxDecodingTime(maxDecodingTime)
		setAvgDecodingTime(averageDecodingTime)

		let newTotalStallDuration = 0
		let newNumberOfStallEvents = 0

		for (let i = 0; i < allRenderedFrames.length - 1; i++) {
			const currentTimestamp = allRenderedFrames[i]._7_renderFrameTimestamp
			const nextTimestamp = allRenderedFrames[i + 1]._7_renderFrameTimestamp
			const difference = nextTimestamp - currentTimestamp

			if (publisherIsWebClient && difference > STALL_EVENT_THRESHOLD) {
				newTotalStallDuration += difference - STALL_EVENT_THRESHOLD
				newNumberOfStallEvents++
			}
			// 24 Fps when streaming BBB
			else if (!publisherIsWebClient && difference > 42) {
				newTotalStallDuration += difference - 42
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

		if (!constantGopSize()) {
			// Adjust GoP size if number of received frames changes
			let newGopSize: number
			if (frameDeliveryRate() < gop1sThreshold()) {
				newGopSize = 1

				if (frameDeliveryRate() < gop0_5sThreshold()) {
					newGopSize = 0.5
				}
			} else {
				newGopSize = EVALUATION_SCENARIO.gopDefault
			}
			if (newGopSize !== targetGopSize()) {
				setTargetGopSize(newGopSize)
				setServerStoredMetrics()
			}
		}
	}, DATA_UPDATE_RATE)

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	createEffect(() => {
		IDBService.initIDBServiceSubscriber()
		setTimeout(() => {
			IDBService.resetIndexedDBSubscriber()
		}, 100)

		if (config.allowDownloadOfSubscriberFrameDataInTheBrowser) {
			setTimeout(async () => {
				downloadFrameData(
					(await IDBService.retrieveFramesFromIndexedDBSubscriber()).filter(
						(aFrame) => aFrame._5_receiveMp4FrameTimestamp !== undefined,
					),
				)
			}, DATA_DOWNLOAD_TIME * 1000)
		}

		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith(config.serverIpAddressForRemoteSubscriber)
			? `https://${server}/fingerprint`
			: undefined

		Player.create({ url, fingerprint, canvas, namespace }).then(setPlayer).catch(setError)
	})

	createEffect(() => {
		const player = usePlayer()
		if (!player) return

		onCleanup(() => {
			player.close().then(setError).catch(setError)
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
			<div class="flex w-2/3 flex-col items-center">
				<Fail error={error()} />

				<span>
					{lastRenderedFrame()?._17_width} x {lastRenderedFrame()?._18_height}
				</span>
				<canvas ref={canvas} onClick={play} class={`aspect-video ${config.subscriberVideoWidth} rounded-lg`} />

				<div class="flex items-center">
					<span>Watch Time: &nbsp;</span>
					<p>{createTimeString(streamWatchTime())}</p>
				</div>

				{/* <div class="flex w-1/2 flex-col items-center justify-center">
					<button
						class="m-3 bg-cyan-600 hover:bg-cyan-800"
						// eslint-disable-next-line @typescript-eslint/no-misused-promises
						onClick={async () => downloadFrameData(await IDBService.retrieveFramesFromIndexedDB())}
					>
						Download data
					</button>
				</div> */}
				{<h3>Segment Data</h3>}

				<div class="flex ">
					<div class="mr-20 flex items-center">
						<span>Total Segments: &nbsp;</span>
						<p>{segmentData().length}</p>
					</div>
				</div>

				{publisherIsWebClient() && (
					<div class="flex">
						<div class="mr-20 flex items-center">
							<span>Propagation Time (min | max | avg): &nbsp;</span>
							<span>{minPropagationTime()} ms | &nbsp;</span>
							<span>{maxPropagationTime()} ms | &nbsp;</span>
							<span>{avgPropagationTime().toFixed(2)} ms&nbsp;</span>
						</div>
					</div>
				)}
				{publisherIsWebClient() && <Plot segments={segmentData().slice(1)} />}
			</div>

			<div class="flex w-1/3 flex-col items-center">
				<h3>Frame Data</h3>

				<div class="flex flex-col items-center justify-center">
					<button
						class={
							displayLatestDataOnly()
								? "m-3 bg-cyan-500 hover:bg-cyan-600"
								: "m-3 bg-cyan-900 hover:bg-cyan-600"
						}
						onClick={() => setDisplayLatestDataOnly(!displayLatestDataOnly())}
					>
						Display Latest Data Only
					</button>
				</div>

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

				{publisherIsWebClient() && (
					<div class="flex">
						<div class="mr-14 flex items-center">
							<span>Skipped Frames: &nbsp;</span>
							<p>{lostFrames()}</p>
						</div>

						<div class="mr-14 flex items-center">
							<span>Frame Delivery Rate: &nbsp;</span>
							<p>{frameDeliveryRate().toFixed(2)} %</p>
						</div>
					</div>
				)}

				<div class="flex">
					<div class="mr-20 flex items-center">
						<span>Decoding Time (min | max | avg): &nbsp;</span>
						<span>{minDecodingTime()} ms | &nbsp;</span>
						<span>{maxDecodingTime()} ms | &nbsp;</span>
						<span>{avgDecodingTime().toFixed(2)} ms&nbsp;</span>
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

				{publisherIsWebClient() && (
					<div class="flex w-1/2 items-center">
						<span>Target GoP Size (s): &nbsp;</span>
						<select
							class="w-1/3"
							onChange={(event) => {
								setConstantGopSize(true)
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
				)}

				{publisherIsWebClient() && (
					<div class="flex items-center">
						GoP 1s FDR Threshold:
						<input
							class="m-3 w-1/3"
							type="range"
							min="15"
							max="99"
							disabled={constantGopSize()}
							value={gop1sThreshold()}
							onChange={(event) => {
								const value = parseInt(event.target.value, 10)
								setGop1sThreshold(value)
							}}
						/>
						<div class="mt-2 text-center">{gop1sThreshold()}%</div>
					</div>
				)}

				{publisherIsWebClient() && (
					<div class="flex items-center">
						GoP 0.5s FDR Threshold:
						<input
							class="m-3 w-1/3"
							type="range"
							min="10"
							max="95"
							disabled={constantGopSize()}
							value={gop0_5sThreshold()}
							onChange={(event) => {
								const value = parseInt(event.target.value, 10)
								setGop0_5sThreshold(value)
							}}
						/>
						<div class="mt-2 text-center">{gop0_5sThreshold()}%</div>
					</div>
				)}

				{publisherIsWebClient() && (
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
				)}

				{publisherIsWebClient() && (
					<div class="flex items-center">
						Bitrate:
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
						<span class="text-slate-400">{(targetBitrate() / 1_000_000).toFixed(1)} Mbps</span>
					</div>
				)}
			</div>
		</div>
	)
}
