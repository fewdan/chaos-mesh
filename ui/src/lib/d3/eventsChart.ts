import * as d3 from 'd3'

import DateTime, { format, now } from 'lib/luxon'

import { Event } from 'api/events.type'
import { IntlShape } from 'react-intl'
import { Theme } from 'slices/settings'
import _debounce from 'lodash.debounce'
import wrapText from './wrapText'

/**
 * The gen function generates the timeline of the events and returns an update function.
 *
 * @export
 * @param {{
 *   root: HTMLElement
 *   events: Event[]
 *   intl: IntlShape
 *   theme: Theme
 *   options?: {
 *     enableLegends?: boolean
 *     onSelectEvent?: (e: Event) => () => void
 *   }
 * }} {
 *   root,
 *   events,
 *   intl,
 *   theme,
 *   options = {
 *     enableLegends: true,
 *   },
 * }
 * @returns {gen~update} - Receive new events and update the chart.
 */
export default function gen({
  root,
  events,
  intl,
  theme,
  options = {
    enableLegends: true,
  },
}: {
  root: HTMLElement
  events: Event[]
  intl: IntlShape
  theme: Theme
  options?: {
    enableLegends?: boolean
    onSelectEvent?: (e: Event) => () => void
  }
}) {
  const { enableLegends, onSelectEvent } = options

  let width = root.offsetWidth
  const height = root.offsetHeight

  const margin = {
    top: 0,
    right: enableLegends && document.documentElement.offsetWidth > 768 ? 150 : 0,
    bottom: 30,
    left: 0,
  }

  const halfHourLater = (events.length ? DateTime.fromISO(events[events.length - 1].start_time) : now()).plus({
    hours: 0.5,
  })

  const colorPalette = d3
    .scaleOrdinal<string, string>()
    .range(d3.schemeTableau10)
    .domain(events.map((d) => d.experiment_id))

  const allUniqueExperiments = [...new Set(events.map((d) => d.experiment + '/' + d.experiment_id))].map((d) => {
    const [name, uuid] = d.split('/')

    return {
      name,
      uuid,
    }
  })
  const allUniqueUUIDs = allUniqueExperiments.map((d) => d.uuid)

  let zoom: d3.ZoomBehavior<SVGSVGElement, unknown>

  const svg = d3
    .select(root)
    .append('svg')
    .attr('class', `chaos-chart${theme === 'light' ? '' : ' dark'}`)
    .attr('width', width)
    .attr('height', height)

  const x = d3
    .scaleLinear()
    .range([margin.left, width - margin.right])
    .domain([halfHourLater.minus({ hours: 1 }), halfHourLater])
  let newX = x
  const xAxis = d3
    .axisBottom(x)
    .ticks(6)
    .tickFormat(d3.timeFormat('%m-%d %H:%M') as any)
  const gXAxis = svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0, ${height - margin.bottom})`)
    .call(xAxis)

  // Wrap long text, also used in zoomed() and reGen()
  gXAxis.selectAll('.tick text').call(wrapText, 30)

  const y = d3
    .scaleBand()
    .range([0, height - margin.top - margin.bottom])
    .domain(allUniqueUUIDs)
    .padding(0.5)
  // gYAxisLeft
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${margin.left}, ${margin.top})`)
    .append('line')
    .attr('stroke-width', 2)
    .attr('y1', margin.top)
    .attr('y2', height - 30)
  const gYAxisRight = svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${width - margin.right + 0.5}, ${margin.top})`)
  gYAxisRight
    .append('line')
    .attr('y1', margin.top)
    .attr('y2', height - 30)

  const timelines = svg
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`)
    .attr('stroke-opacity', 0.6)
    .selectAll()
    .data(allUniqueUUIDs)
    .join('line')
    .attr('y1', (d) => y(d)! + y.bandwidth() / 2)
    .attr('y2', (d) => y(d)! + y.bandwidth() / 2)
    .attr('x2', width - margin.right - margin.left)
    .attr('stroke', colorPalette)

  // clipX
  svg
    .append('clipPath')
    .attr('id', 'clip-x-axis')
    .append('rect')
    .attr('x', margin.left)
    .attr('y', 0)
    .attr('width', width - margin.left - margin.right)
    .attr('height', height - margin.bottom)
  const gMain = svg.append('g').attr('clip-path', 'url(#clip-x-axis)')

  // legends
  const legendsRoot = d3
    .select(document.createElement('div'))
    .attr('class', `chaos-events-legends${theme === 'light' ? '' : ' dark'}`)
  if (enableLegends) {
    legends()
  }
  function legends() {
    const legends = legendsRoot
      .selectAll()
      .data(allUniqueExperiments)
      .enter()
      .append('div')
      .on('click', function (_, d) {
        const _events = events.filter((e) => e.experiment_id === d.uuid)
        const event = _events[_events.length - 1]

        svg
          .transition()
          .duration(750)
          .call(
            zoom.transform,
            d3.zoomIdentity
              .translate((width - margin.left - margin.right) / 2, 0)
              .scale(3)
              .translate(-x(DateTime.fromISO(event.start_time)), 0)
          )
      })
    legends
      .append('div')
      .attr('class', 'square')
      .attr('style', (d) => `background: ${colorPalette(d.uuid)};`)
    legends
      .insert('div')
      .attr('class', 'experiment')
      .text((d) => d.name)
  }

  const tooltip = d3
    .select(document.createElement('div'))
    .attr('class', `chaos-event-tooltip${theme === 'light' ? '' : ' dark'}`)

  function genTooltipContent(d: Event) {
    return `<b>${intl.formatMessage({ id: 'events.event.experiment' })}: ${d.experiment}</b>
            <br />
            <b>
              ${intl.formatMessage({ id: 'common.status' })}:
              ${
                d.finish_time
                  ? intl.formatMessage({ id: 'experiments.state.finished' })
                  : intl.formatMessage({ id: 'experiments.state.running' })
              }
            </b>
            <br />
            <br />
            <span class="secondary">
              ${intl.formatMessage({ id: 'events.event.started' })}: ${format(d.start_time)}
            </span>
            <br />
            ${
              d.finish_time
                ? `
                  <span class="secondary">
                    ${intl.formatMessage({ id: 'events.event.ended' })}: ${format(d.finish_time)}
                  </span>`
                : ''
            }`
  }

  if (enableLegends) {
    root.appendChild(legendsRoot.node()!)
  }
  root.style.position = 'relative'
  root.appendChild(tooltip.node()!)

  /**
   * Receive new events and update the chart.
   *
   * @param {Event[]} events
   */
  function update(events: Event[]) {
    const circles = gMain
      .selectAll('circle')
      .data(events)
      .join((enter) => {
        const newCx = (d: Event) => newX(DateTime.fromISO(d.start_time))

        return enter
          .append('circle')
          .attr('opacity', 0)
          .attr('cx', (d) => newCx(d) + 30)
          .call((enter) => enter.transition().duration(750).attr('opacity', 1).attr('cx', newCx))
      })
      .attr('cy', (d) => y(d.experiment_id)! + y.bandwidth() / 2 + margin.top)
      .attr('fill', (d) => colorPalette(d.experiment_id))
      .attr('r', 4)
      .style('cursor', 'pointer')
      .on('click', (_, d) => {
        if (typeof onSelectEvent === 'function') {
          onSelectEvent(d)()
        }
      })
      .on('mouseover', function (event, d) {
        let [x, y] = d3.pointer(event)

        tooltip.html(genTooltipContent(d))
        const { width } = tooltip.node()!.getBoundingClientRect()

        y += 50
        if (x > (root.offsetWidth / 3) * 2) {
          x -= width
        }
        if (y > (root.offsetHeight / 3) * 2) {
          y -= 200
        }

        tooltip
          .style('left', x + 'px')
          .style('top', y + 'px')
          .style('opacity', 1)
          .style('z-index', 'unset')
      })
      .on('mouseleave', () => tooltip.style('opacity', 0).style('z-index', -1))

    function zoomed({ transform }: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
      newX = transform.rescaleX(x)

      gXAxis.call(xAxis.scale(newX))
      gXAxis.selectAll('.tick text').call(wrapText, 30)
      circles.attr('cx', (d) => newX(DateTime.fromISO(d.start_time))!)
    }

    zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 6]).on('zoom', zoomed)
    svg.call(zoom)

    function reGen() {
      const newWidth = root.offsetWidth
      width = newWidth

      svg.attr('width', width).call(zoom.transform, d3.zoomIdentity)
      gXAxis.call(xAxis.scale(x.range([margin.left, width - margin.right])))
      gXAxis.selectAll('.tick text').call(wrapText, 30)
      gYAxisRight.attr('transform', `translate(${width - margin.right + 0.5}, ${margin.top})`)
      timelines.attr('x2', width - margin.right - margin.left)
      circles.attr('cx', (d) => x(DateTime.fromISO(d.start_time)))
    }

    d3.select(window).on('resize', _debounce(reGen, 250))
  }
  update(events)

  return update
}
