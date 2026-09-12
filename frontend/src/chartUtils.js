// Shared scale and path helpers for the hand-rolled SVG charts.
//
// One scale per chart positions the line, the fills, the reference rules and
// every label, so nothing can drift out of alignment. Kept here rather than
// copied into each chart for the same reason.

export function makeScale(options) {
  const { xMin, xMax, yMin, yMax, left, right, top, bottom } = options;

  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const plotWidth = right - left;
  const plotHeight = bottom - top;

  return {
    left: left,
    right: right,
    top: top,
    bottom: bottom,
    plotWidth: plotWidth,
    plotHeight: plotHeight,
    x(value) {
      return left + ((value - xMin) / xSpan) * plotWidth;
    },
    y(value) {
      return top + (1 - (value - yMin) / ySpan) * plotHeight;
    },
    // Inverse, for turning a mouse position back into a data value.
    xValue(pixel) {
      return xMin + ((pixel - left) / plotWidth) * xSpan;
    },
  };
}

export function linePath(points, scale, getX, getY) {
  const commands = [];
  for (let index = 0; index < points.length; index += 1) {
    const command = index === 0 ? "M" : "L";
    commands.push(
      command +
        scale.x(getX(points[index])).toFixed(2) +
        " " +
        scale.y(getY(points[index])).toFixed(2)
    );
  }
  return commands.join(" ");
}

export function formatClock(timestampMs) {
  const date = new Date(timestampMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return hours + ":" + minutes;
}

// Index of the point nearest a given x value — for the hover crosshair.
export function nearestIndex(points, getX, target) {
  if (points.length === 0) {
    return -1;
  }
  let bestIndex = 0;
  let bestGap = Math.abs(getX(points[0]) - target);
  for (let index = 1; index < points.length; index += 1) {
    const gap = Math.abs(getX(points[index]) - target);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  }
  return bestIndex;
}

// Contiguous runs where a test holds, as [startIndex, endIndex] pairs. Used
// to shade the stretches where a correlation rule is actually firing.
export function runsWhere(points, test) {
  const runs = [];
  let start = -1;
  for (let index = 0; index < points.length; index += 1) {
    if (test(points[index])) {
      if (start === -1) {
        start = index;
      }
    } else if (start !== -1) {
      runs.push([start, index - 1]);
      start = -1;
    }
  }
  if (start !== -1) {
    runs.push([start, points.length - 1]);
  }
  return runs;
}
