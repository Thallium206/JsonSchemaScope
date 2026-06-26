"use strict";

const DEFAULT_FILE_NAME = "nom.json";
const NODE_WIDTH = 268;
const COLUMN_GAP = 340;
const ROW_GAP = 70;
const TYPE_ORDER = ["string", "int", "float", "boolean", "null", "object", "array"];

const sampleJson = {
  pieces: [
    {
      id: "piece-001",
      name: "Capot avant",
      material: {
        id: "mat-001",
        name: "Aluminium",
        color: "silver"
      }
    },
    {
      id: "piece-002",
      material_id: "mat-002"
    }
  ],
  tools: [
    {
      id: "tool-001",
      name: "Tournevis",
      type: "manual",
      size: "T20",
      reference: null
    }
  ],
  steps: [
    {
      step_id: 1,
      piece_id: "piece-001",
      start_pose: {
        position: [0, 1.2, 3],
        rotation: [0, 0, 0]
      },
      instruction: "Positionner la piece",
      tool_ids_required: ["tool-001"],
      resource: [
        {
          type: "image",
          path: "assets/step-01.png"
        }
      ]
    },
    {
      step_id: 2,
      piece_id: "piece-002",
      instruction: null,
      fastener_ids_required: ["fastener-001"],
      torque: {
        value: 12.5,
        unit: "Nm"
      }
    }
  ],
  enabled: true
};

const refs = {
  fileInput: document.querySelector("#fileInput"),
  fileNameLabel: document.querySelector("#fileNameLabel"),
  formatButton: document.querySelector("#formatButton"),
  resetViewButton: document.querySelector("#resetViewButton"),
  jsonInput: document.querySelector("#jsonInput"),
  jsonMeta: document.querySelector("#jsonMeta"),
  graphMeta: document.querySelector("#graphMeta"),
  errorBox: document.querySelector("#errorBox"),
  graphViewport: document.querySelector("#graphViewport"),
  graphCanvas: document.querySelector("#graphCanvas"),
  edgeLayer: document.querySelector("#edgeLayer"),
  nodeLayer: document.querySelector("#nodeLayer")
};

let currentFileName = DEFAULT_FILE_NAME;
let currentGraph = { nodes: [], edges: [] };
let updateTimer = 0;
let userMovedView = false;
let transform = { x: 52, y: 42, scale: 1 };
let dragState = null;

refs.jsonInput.value = JSON.stringify(sampleJson, null, 2);
renderFromInput({ fit: true });

refs.jsonInput.addEventListener("input", () => {
  updateTextMeta();
  clearTimeout(updateTimer);
  updateTimer = window.setTimeout(() => renderFromInput({ fit: false }), 180);
});

refs.fileInput.addEventListener("change", async (event) => {
  const [file] = Array.from(event.target.files || []);
  if (!file) return;

  currentFileName = file.name || DEFAULT_FILE_NAME;
  refs.fileNameLabel.textContent = currentFileName;
  refs.jsonInput.value = await file.text();
  userMovedView = false;
  renderFromInput({ fit: true });
  refs.fileInput.value = "";
});

refs.formatButton.addEventListener("click", () => {
  try {
    const parsed = JSON.parse(refs.jsonInput.value);
    refs.jsonInput.value = JSON.stringify(parsed, null, 2);
    renderFromInput({ fit: true });
  } catch (error) {
    showParseError(error);
  }
});

refs.resetViewButton.addEventListener("click", () => {
  userMovedView = false;
  fitGraphToViewport();
});

refs.graphViewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = refs.graphViewport.getBoundingClientRect();
  const point = {
    x: (event.clientX - rect.left - transform.x) / transform.scale,
    y: (event.clientY - rect.top - transform.y) / transform.scale
  };
  const nextScale = clamp(transform.scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.32, 1.85);

  transform = {
    x: event.clientX - rect.left - point.x * nextScale,
    y: event.clientY - rect.top - point.y * nextScale,
    scale: nextScale
  };
  userMovedView = true;
  applyTransform();
}, { passive: false });

refs.graphViewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest(".graph-node")) return;
  dragState = {
    type: "pan",
    startX: event.clientX,
    startY: event.clientY,
    originX: transform.x,
    originY: transform.y
  };
  refs.graphViewport.classList.add("is-panning");
  refs.graphViewport.setPointerCapture(event.pointerId);
});

window.addEventListener("pointermove", (event) => {
  if (!dragState) return;

  if (dragState.type === "pan") {
    transform.x = dragState.originX + event.clientX - dragState.startX;
    transform.y = dragState.originY + event.clientY - dragState.startY;
    userMovedView = true;
    applyTransform();
    return;
  }

  if (dragState.type === "node") {
    const node = currentGraph.nodes.find((item) => item.id === dragState.nodeId);
    if (!node) return;

    node.x = dragState.originX + (event.clientX - dragState.startX) / transform.scale;
    node.y = dragState.originY + (event.clientY - dragState.startY) / transform.scale;
    userMovedView = true;
    positionNode(node);
    drawEdges();
  }
});

window.addEventListener("pointerup", () => {
  if (!dragState) return;
  document.querySelector(".graph-node.is-dragging")?.classList.remove("is-dragging");
  refs.graphViewport.classList.remove("is-panning");
  dragState = null;
});

window.addEventListener("resize", () => {
  if (!userMovedView) fitGraphToViewport();
});

function renderFromInput({ fit }) {
  updateTextMeta();

  try {
    const parsed = JSON.parse(refs.jsonInput.value);
    hideParseError();
    currentGraph = buildGraph(parsed, currentFileName);
    layoutGraph(currentGraph);
    renderGraph();
    if (fit || !userMovedView) fitGraphToViewport();
  } catch (error) {
    showParseError(error);
  }
}

function buildGraph(data, fileName) {
  const graph = { nodes: [], edges: [] };
  let nodeIndex = 0;

  const createObjectNode = (name, samples, meta = {}) => {
    const node = {
      id: `node-${nodeIndex++}`,
      name,
      fields: [],
      kind: meta.kind || "object",
      sampleCount: samples.length,
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: 80
    };

    graph.nodes.push(node);

    for (const key of collectOrderedKeys(samples)) {
      const values = [];
      let presentCount = 0;

      for (const sample of samples) {
        if (Object.prototype.hasOwnProperty.call(sample, key)) {
          presentCount += 1;
          values.push(sample[key]);
        }
      }

      const childSamples = collectObjectSamples(values);
      const field = {
        name: key,
        type: describeValues(values),
        optional: presentCount < samples.length,
        hasChild: childSamples.length > 0
      };

      node.fields.push(field);

      if (childSamples.length > 0) {
        const child = createObjectNode(key, childSamples, {
          kind: values.some((value) => Array.isArray(value)) ? "array" : "object"
        });
        graph.edges.push({
          from: node.id,
          to: child.id,
          label: key,
          optional: field.optional
        });
      }
    }

    node.height = estimateNodeHeight(node);
    return node;
  };

  if (isPlainObject(data)) {
    createObjectNode(fileName, [data], { kind: "object" });
  } else if (Array.isArray(data)) {
    const objectSamples = collectObjectSamples([data]);

    if (objectSamples.length > 0) {
      createObjectNode(fileName, objectSamples, { kind: "array" });
    } else {
      graph.nodes.push(createValueNode(fileName, `items: ${describeValues([data])}`, nodeIndex++));
    }
  } else {
    graph.nodes.push(createValueNode(fileName, `value: ${primitiveType(data)}`, nodeIndex++));
  }

  return graph;
}

function createValueNode(name, fieldText, index) {
  const [fieldName, type] = fieldText.split(": ");
  return {
    id: `node-${index}`,
    name,
    fields: [{
      name: fieldName,
      type,
      optional: false,
      hasChild: false
    }],
    kind: "value",
    sampleCount: 1,
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: 118
  };
}

function collectOrderedKeys(samples) {
  const seen = new Set();
  const keys = [];

  for (const sample of samples) {
    for (const key of Object.keys(sample)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  return keys;
}

function collectObjectSamples(values) {
  const samples = [];

  for (const value of values) {
    if (isPlainObject(value)) {
      samples.push(value);
    } else if (Array.isArray(value)) {
      collectObjectsFromArray(value, samples);
    }
  }

  return samples;
}

function collectObjectsFromArray(array, samples) {
  for (const item of array) {
    if (isPlainObject(item)) {
      samples.push(item);
    } else if (Array.isArray(item)) {
      collectObjectsFromArray(item, samples);
    }
  }
}

function describeValues(values) {
  const types = new Set();

  for (const value of values) {
    if (Array.isArray(value)) {
      types.add(describeArrayValues([value]));
    } else if (isPlainObject(value)) {
      types.add("object");
    } else {
      types.add(primitiveType(value));
    }
  }

  return orderTypes(Array.from(types)).join(" | ");
}

function describeArrayValues(arrays) {
  const types = new Set();
  let hasElement = false;

  for (const array of arrays) {
    for (const item of array) {
      hasElement = true;

      if (Array.isArray(item)) {
        types.add(describeArrayValues([item]));
      } else if (isPlainObject(item)) {
        types.add("object");
      } else {
        types.add(primitiveType(item));
      }
    }
  }

  if (!hasElement) return "array<empty>";
  return `array<${orderTypes(Array.from(types)).join(" | ")}>`;
}

function primitiveType(value) {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return typeof value;
}

function orderTypes(types) {
  return types.sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
}

function typeRank(type) {
  if (type.startsWith("array<")) return TYPE_ORDER.indexOf("array");
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
}

function layoutGraph(graph) {
  const childrenByNode = new Map();
  for (const edge of graph.edges) {
    if (!childrenByNode.has(edge.from)) childrenByNode.set(edge.from, []);
    childrenByNode.get(edge.from).push(edge.to);
  }

  let cursorY = 0;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const root = graph.nodes[0];

  const placeNode = (node, depth) => {
    const children = childrenByNode.get(node.id) || [];
    node.x = depth * COLUMN_GAP;

    if (children.length === 0) {
      node.y = cursorY;
      cursorY += node.height + ROW_GAP;
      return;
    }

    for (const childId of children) {
      const child = nodeById.get(childId);
      if (child) placeNode(child, depth + 1);
    }

    const childNodes = children.map((childId) => nodeById.get(childId)).filter(Boolean);
    const firstChild = childNodes[0];
    const lastChild = childNodes[childNodes.length - 1];
    const firstCenter = firstChild.y + firstChild.height / 2;
    const lastCenter = lastChild.y + lastChild.height / 2;
    node.y = (firstCenter + lastCenter) / 2 - node.height / 2;
  };

  if (root) placeNode(root, 0);
}

function renderGraph() {
  refs.nodeLayer.replaceChildren();
  refs.edgeLayer.replaceChildren(createArrowMarker());

  for (const node of currentGraph.nodes) {
    const element = createNodeElement(node);
    refs.nodeLayer.appendChild(element);
    positionNode(node);
  }

  updateGraphCanvasSize();
  drawEdges();
  updateGraphMeta();
}

function createNodeElement(node) {
  const element = document.createElement("article");
  element.className = "graph-node";
  element.dataset.nodeId = node.id;

  const header = document.createElement("div");
  header.className = "node-header";
  header.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id));

  const title = document.createElement("span");
  title.className = "node-title";
  title.textContent = node.name;
  title.title = node.name;

  const kind = document.createElement("span");
  kind.className = "node-kind";
  kind.textContent = node.kind;

  header.append(title, kind);
  element.appendChild(header);

  if (node.fields.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-node";
    empty.textContent = "objet vide";
    element.appendChild(empty);
    return element;
  }

  const list = document.createElement("ul");
  list.className = "field-list";

  for (const field of node.fields) {
    const row = document.createElement("li");
    row.className = "field-row";
    row.dataset.kind = classifyType(field.type);
    row.dataset.fieldName = field.name;
    if (field.hasChild) row.dataset.linked = "true";

    const main = document.createElement("div");
    main.className = "field-main";

    const name = document.createElement("span");
    name.className = "field-name";
    name.textContent = field.name;
    name.title = field.name;
    main.appendChild(name);

    if (field.optional) {
      const mark = document.createElement("span");
      mark.className = "optional-mark";
      mark.textContent = "?";
      mark.title = "optionnel";
      main.appendChild(mark);
    }

    const type = document.createElement("span");
    type.className = "type-pill";
    type.dataset.kind = classifyType(field.type);
    type.textContent = field.type;
    type.title = field.type;

    row.append(main, type);

    if (field.optional) {
      const optional = document.createElement("span");
      optional.className = "optional-label";
      optional.textContent = "optionnel";
      row.appendChild(optional);
    }

    list.appendChild(row);
  }

  element.appendChild(list);
  return element;
}

function startNodeDrag(event, nodeId) {
  if (event.button !== 0) return;

  const node = currentGraph.nodes.find((item) => item.id === nodeId);
  if (!node) return;

  const element = event.currentTarget.closest(".graph-node");
  element.classList.add("is-dragging");
  element.setPointerCapture(event.pointerId);
  dragState = {
    type: "node",
    nodeId,
    startX: event.clientX,
    startY: event.clientY,
    originX: node.x,
    originY: node.y
  };
}

function positionNode(node) {
  const element = refs.nodeLayer.querySelector(`[data-node-id="${cssEscape(node.id)}"]`);
  if (!element) return;
  element.style.transform = `translate(${node.x}px, ${node.y}px)`;
}

function drawEdges() {
  refs.edgeLayer.querySelectorAll(".edge-group").forEach((edge) => edge.remove());

  const nodeById = new Map(currentGraph.nodes.map((node) => [node.id, node]));

  for (const edge of currentGraph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;

    const start = getFieldAnchor(from, edge.label) || {
      x: from.x + from.width,
      y: from.y + from.height / 2
    };
    const end = {
      x: to.x,
      y: to.y + to.height / 2
    };
    const curve = Math.max(78, Math.abs(end.x - start.x) * 0.42);
    const pathData = `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`;
    const labelX = start.x + (end.x - start.x) / 2;
    const labelY = start.y + (end.y - start.y) / 2 - 10;

    const group = svgElement("g", { class: "edge-group" });
    const path = svgElement("path", {
      class: `edge-path${edge.optional ? " optional" : ""}`,
      d: pathData,
      "marker-end": "url(#arrowHead)"
    });
    const label = svgElement("text", {
      class: "edge-label",
      x: labelX,
      y: labelY,
      "text-anchor": "middle"
    });
    label.textContent = edge.label;

    const bg = svgElement("rect", {
      class: "edge-label-bg",
      x: labelX - Math.max(28, edge.label.length * 3.7),
      y: labelY - 15,
      width: Math.max(56, edge.label.length * 7.4),
      height: 21,
      rx: 8
    });

    group.append(path, bg, label);
    refs.edgeLayer.appendChild(group);
  }
}

function getFieldAnchor(node, fieldName) {
  const nodeElement = refs.nodeLayer.querySelector(`[data-node-id="${cssEscape(node.id)}"]`);
  if (!nodeElement) return null;

  const fieldRow = Array.from(nodeElement.querySelectorAll(".field-row"))
    .find((row) => row.dataset.fieldName === fieldName);
  if (!fieldRow) return null;

  const fieldMain = fieldRow.querySelector(".field-main");
  const verticalCenter = fieldMain
    ? fieldRow.offsetTop + fieldMain.offsetTop + fieldMain.offsetHeight / 2
    : fieldRow.offsetTop + fieldRow.offsetHeight / 2;

  return {
    x: node.x + node.width,
    y: node.y + verticalCenter
  };
}

function createArrowMarker() {
  const defs = svgElement("defs");
  const marker = svgElement("marker", {
    id: "arrowHead",
    markerWidth: "10",
    markerHeight: "10",
    refX: "8",
    refY: "5",
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  marker.appendChild(svgElement("path", {
    d: "M 0 0 L 10 5 L 0 10 z",
    fill: "var(--graph-line)"
  }));
  defs.appendChild(marker);
  return defs;
}

function updateGraphCanvasSize() {
  const bounds = graphBounds();
  const width = Math.max(1200, bounds.maxX + 220);
  const height = Math.max(900, bounds.maxY + 180);

  refs.graphCanvas.style.width = `${width}px`;
  refs.graphCanvas.style.height = `${height}px`;
  refs.edgeLayer.setAttribute("width", width);
  refs.edgeLayer.setAttribute("height", height);
}

function graphBounds() {
  if (currentGraph.nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 900, maxY: 600 };
  }

  return currentGraph.nodes.reduce((bounds, node) => ({
    minX: Math.min(bounds.minX, node.x),
    minY: Math.min(bounds.minY, node.y),
    maxX: Math.max(bounds.maxX, node.x + node.width),
    maxY: Math.max(bounds.maxY, node.y + node.height)
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });
}

function fitGraphToViewport() {
  const bounds = graphBounds();
  const rect = refs.graphViewport.getBoundingClientRect();
  const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
  const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clamp(Math.min(
    (rect.width - 80) / graphWidth,
    (rect.height - 80) / graphHeight,
    1
  ), 0.38, 1);

  transform = {
    x: Math.max(36, (rect.width - graphWidth * scale) / 2 - bounds.minX * scale),
    y: Math.max(36, (rect.height - graphHeight * scale) / 2 - bounds.minY * scale),
    scale
  };
  applyTransform();
}

function applyTransform() {
  refs.graphCanvas.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
}

function updateTextMeta() {
  const text = refs.jsonInput.value;
  const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  refs.jsonMeta.textContent = `${lines} ligne${lines > 1 ? "s" : ""}`;
}

function updateGraphMeta() {
  const nodeCount = currentGraph.nodes.length;
  const fieldCount = currentGraph.nodes.reduce((sum, node) => sum + node.fields.length, 0);
  refs.graphMeta.textContent = `${nodeCount} noeud${nodeCount > 1 ? "s" : ""} - ${fieldCount} champ${fieldCount > 1 ? "s" : ""}`;
}

function showParseError(error) {
  const details = parseErrorDetails(refs.jsonInput.value, error);
  refs.errorBox.hidden = false;
  refs.errorBox.textContent = `Erreur JSON - ligne ${details.line}, colonne ${details.column}: ${details.message}`;
}

function hideParseError() {
  refs.errorBox.hidden = true;
  refs.errorBox.textContent = "";
}

function parseErrorDetails(text, error) {
  const message = error instanceof Error ? error.message : String(error);
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);

  if (lineColumnMatch) {
    return {
      message,
      line: Number(lineColumnMatch[1]),
      column: Number(lineColumnMatch[2])
    };
  }

  const positionMatch = message.match(/position\s+(\d+)/i);
  const position = positionMatch ? Number(positionMatch[1]) : findJsonSyntaxIndex(text) ?? text.length;
  const location = positionToLineColumn(text, position);

  return {
    message,
    line: location.line,
    column: location.column
  };
}

function positionToLineColumn(text, position) {
  let line = 1;
  let column = 1;
  const limit = Math.min(position, text.length);

  for (let index = 0; index < limit; index += 1) {
    if (text[index] === "\r") {
      line += 1;
      column = 1;
      if (text[index + 1] === "\n") index += 1;
    } else if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function findJsonSyntaxIndex(text) {
  let index = 0;

  const fail = () => {
    throw index;
  };

  const skipWhitespace = () => {
    while (/[\s]/.test(text[index] || "")) index += 1;
  };

  const parseLiteral = (literal) => {
    if (!text.startsWith(literal, index)) fail();
    index += literal.length;
  };

  const parseString = () => {
    if (text[index] !== "\"") fail();
    index += 1;

    while (index < text.length) {
      const char = text[index];

      if (char === "\"") {
        index += 1;
        return;
      }

      if (char === "\\") {
        index += 1;
        const escape = text[index];
        if (!"\"\\/bfnrtu".includes(escape || "")) fail();

        if (escape === "u") {
          for (let offset = 1; offset <= 4; offset += 1) {
            if (!/[0-9a-fA-F]/.test(text[index + offset] || "")) fail();
          }
          index += 5;
        } else {
          index += 1;
        }
        continue;
      }

      if (char < " ") fail();
      index += 1;
    }

    fail();
  };

  const parseNumber = () => {
    if (text[index] === "-") index += 1;

    if (text[index] === "0") {
      index += 1;
    } else if (/[1-9]/.test(text[index] || "")) {
      while (/[0-9]/.test(text[index] || "")) index += 1;
    } else {
      fail();
    }

    if (text[index] === ".") {
      index += 1;
      if (!/[0-9]/.test(text[index] || "")) fail();
      while (/[0-9]/.test(text[index] || "")) index += 1;
    }

    if (text[index] === "e" || text[index] === "E") {
      index += 1;
      if (text[index] === "+" || text[index] === "-") index += 1;
      if (!/[0-9]/.test(text[index] || "")) fail();
      while (/[0-9]/.test(text[index] || "")) index += 1;
    }
  };

  const parseArray = () => {
    index += 1;
    skipWhitespace();

    if (text[index] === "]") {
      index += 1;
      return;
    }

    while (index < text.length) {
      parseValue();
      skipWhitespace();

      if (text[index] === ",") {
        index += 1;
        skipWhitespace();
        continue;
      }

      if (text[index] === "]") {
        index += 1;
        return;
      }

      fail();
    }

    fail();
  };

  const parseObject = () => {
    index += 1;
    skipWhitespace();

    if (text[index] === "}") {
      index += 1;
      return;
    }

    while (index < text.length) {
      if (text[index] !== "\"") fail();
      parseString();
      skipWhitespace();

      if (text[index] !== ":") fail();
      index += 1;
      parseValue();
      skipWhitespace();

      if (text[index] === ",") {
        index += 1;
        skipWhitespace();
        continue;
      }

      if (text[index] === "}") {
        index += 1;
        return;
      }

      fail();
    }

    fail();
  };

  function parseValue() {
    skipWhitespace();

    if (index >= text.length) fail();

    const char = text[index];
    if (char === "\"") return parseString();
    if (char === "{") return parseObject();
    if (char === "[") return parseArray();
    if (char === "-" || /[0-9]/.test(char)) return parseNumber();
    if (char === "t") return parseLiteral("true");
    if (char === "f") return parseLiteral("false");
    if (char === "n") return parseLiteral("null");
    fail();
  }

  try {
    parseValue();
    skipWhitespace();
    return index < text.length ? index : null;
  } catch (errorIndex) {
    return Number.isInteger(errorIndex) ? errorIndex : text.length;
  }
}

function estimateNodeHeight(node) {
  if (node.fields.length === 0) return 96;
  const optionalRows = node.fields.filter((field) => field.optional).length;
  return 58 + node.fields.length * 35 + optionalRows * 21;
}

function classifyType(type) {
  if (type.includes(" | ")) return "mixed";
  if (type.startsWith("array<")) return "array";
  if (type === "object") return "object";
  if (type === "string") return "string";
  if (type === "int") return "int";
  if (type === "float") return "float";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";
  return "mixed";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function svgElement(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);

  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }

  return element;
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
