import { createEffect } from "solid-js"
import * as Plotly from "plotly.js-dist"
import type { IndexedDBSegmentsSchemaSubscriber } from "@kixelated/moq/common"

interface ChartProps {
	segments: IndexedDBSegmentsSchemaSubscriber[]
}

const ChartComponent = (props: ChartProps) => {
	createEffect(() => {
		const trace = [
			{
				x: props.segments.map((aSegment) => (aSegment.receiveTime - props.segments[0].receiveTime) / 1000),
				y: props.segments.map((aSegment) => aSegment.propagationTime),
				name: "Segment Propagation Time",
				mode: "lines",
				marker: { color: "blue" },
			},
		]

		const layout = {
			width: 800,
			height: 300,
			xaxis: {
				title: "Time (s)",
			},
			yaxis: {
				title: "Propagation Time (ms)",
			},
			showlegend: true,
		}

		void Plotly.newPlot("chart", trace, layout)

		return () => Plotly.purge("chart") // Cleanup when component unmounts
	})

	return <div id="chart" />
}

export default ChartComponent
