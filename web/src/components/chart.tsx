import { createEffect } from "solid-js"
import Chart from "chart.js/auto"
import * as ch from "chart.js/auto"
import type { IndexedDBFramesSchema } from "@kixelated/moq/contribute"

let chart: Chart // define chart variable outside of function

const chartTypes: { [key: string]: ch.ChartType } = {
	line: "line",
	bar: "bar",
}

interface ChartProps {
	frames: IndexedDBFramesSchema[]
}

const Plot = (props: ChartProps) => {
	createEffect(() => {
		// console.log("CHART_RENDER")
		const frames = props.frames

		const canvas = document.getElementById("chart") as HTMLCanvasElement
		// canvas.transferControlToOffscreen()
		const ctx = canvas.getContext("2d")
		const configuration = {
			type: chartTypes["line"],
			data: {
				labels: frames.map((aFrame) =>
					new Date(Date.now() - aFrame._5_receiveMp4FrameTimestamp).toLocaleTimeString(),
				),
				datasets: [
					{
						label: "Frame Total Time",
						data: frames.map((aFrame) => aFrame._8_totalTime),
						borderColor: "red",
						tension: 1,
					},
					{
						label: "Frame Segmentation Time",
						data: frames.map((aFrame) => aFrame._2_segmentationTime),
						borderColor: "blue",
						tension: 0,
					},
					{
						label: "Frame Propagation Time",
						data: frames.map((aFrame) => aFrame._4_propagationTime),
						borderColor: "green",
						tension: 1,
					},
					{
						label: "Frame Render Time",
						data: frames.map((aFrame) => aFrame._6_renderFrameTime),
						borderColor: "yellow",
						tension: 0.1,
					},
				],
			},
			options: {
				scales: {
					x: {
						title: {
							display: true,
							text: "Time",
						},
					},
					y: {
						title: {
							display: true,
							text: "Frame Times",
						},
					},
				},
			},
		}

		if (chart) {
			chart.destroy()
			// console.log("DESTROYED")

			if (ctx) {
				chart = new Chart(ctx, configuration)
			}
		} else {
			if (ctx) {
				chart = new Chart(ctx, configuration)
			}
		}

		return () => chart.destroy() // Cleanup when component unmounts
	})

	return (
		<div>
			<div>
				<canvas id="chart" />
			</div>
		</div>
	)
}

export default Plot
