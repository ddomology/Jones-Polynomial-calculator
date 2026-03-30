import { createEditor } from "./editor.js";

const els = {
  canvas: document.getElementById("editor-canvas"),

  modeDraw: document.getElementById("mode-draw"),
  modeEdit: document.getElementById("mode-edit"),
  modeCrossing: document.getElementById("mode-crossing"),

  clearCanvas: document.getElementById("clear-canvas"),
  loadExample: document.getElementById("load-example"),
  exportKnot: document.getElementById("export-knot"),

  writheOutput: document.getElementById("writhe-output"),
  bracketOutput: document.getElementById("bracket-output"),
};

const state = {
  mode: "draw",
  selectedExampleIndex: 0,
  buildDiagramFromEditorState: null,
  computeJonesData: null,
  examples: [],
};

function bindEvents() {
  els.modeDraw?.addEventListener("click", () => setMode("draw"));
  els.modeEdit?.addEventListener("click", () => setMode("edit"));
  els.modeCrossing?.addEventListener("click", () => setMode("crossing"));

  els.clearCanvas?.addEventListener("click", () => {
    editor.clear();
    clearOutputs();
  });

  els.loadExample?.addEventListener("click", () => {
    if (!state.examples.length) {
      console.warn("examples.js가 아직 로드되지 않았거나 예제가 없다.");
      return;
    }

    const example = state.examples[state.selectedExampleIndex % state.examples.length];
    state.selectedExampleIndex += 1;

    editor.loadExample(example);
    refreshAll();
  });
}

function setMode(mode) {
  state.mode = mode;
  editor.setMode(mode);
  updateModeButtons();
}

function updateModeButtons() {
  const buttons = [
    { mode: "draw", el: els.modeDraw },
    { mode: "edit", el: els.modeEdit },
    { mode: "crossing", el: els.modeCrossing },
  ];

  for (const { mode, el } of buttons) {
    if (!el) continue;

    const isActive = mode === state.mode;
    el.classList.toggle("is-active", isActive);
    el.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function handleEditorChange() {
  const editorState = editor.getState();

  if (editorState.mode && editorState.mode !== state.mode) {
    state.mode = editorState.mode;
    updateModeButtons();
  }

  refreshAll();
}

function handleEditorStatus(message) {
  console.log("[editor]", message);
}

async function loadOptionalModules() {
  try {
    const diagramModule = await import("./diagram.js");
    if (typeof diagramModule.buildDiagramFromEditorState === "function") {
      state.buildDiagramFromEditorState = diagramModule.buildDiagramFromEditorState;
    }
  } catch (error) {
    console.error("diagram.js 로드 실패:", error);
  }

  try {
    const polynomialModule = await import("./polynomial.js");
    if (typeof polynomialModule.computeJonesData === "function") {
      state.computeJonesData = polynomialModule.computeJonesData;
    }
  } catch (error) {
    console.error("polynomial.js 로드 실패:", error);
  }

  try {
    const examplesModule = await import("./examples.js");
    if (Array.isArray(examplesModule.examples)) {
      state.examples = examplesModule.examples;
    }
  } catch (error) {
    console.error("examples.js 로드 실패:", error);
  }

  refreshAll();
}

function refreshAll() {
  if (!state.buildDiagramFromEditorState) {
    clearOutputs();
    return;
  }

  let diagram;
  try {
    diagram = state.buildDiagramFromEditorState(editor.getState());
  } catch (error) {
    console.error("diagram 생성 실패:", error);
    clearOutputs();
    return;
  }

  renderWrithe(diagram.writhe);

  if (!state.computeJonesData) {
    renderMath(els.bracketOutput, "-");
    renderMath(els.jonesOutput, "-");
    return;
  }

  const crossings = diagram.crossings ?? [];
  const hasAnyCrossing = crossings.length > 0;
  const allResolved = crossings.every(
    (crossing) => crossing.over === "a" || crossing.over === "b"
  );

  if (!hasAnyCrossing) {
    renderMath(els.bracketOutput, "-");
    renderMath(els.jonesOutput, "-");
    return;
  }

  if (!allResolved) {
    renderMath(els.bracketOutput, "?");
    renderMath(els.jonesOutput, "?");
    return;
  }

  try {
    const result = state.computeJonesData(diagram);
    renderMath(els.bracketOutput, result?.bracketString ?? "-");
    renderMath(els.jonesOutput, result?.jonesString ?? "-");
  } catch (error) {
    console.error("다항식 계산 실패:", error);
    renderMath(els.bracketOutput, "?");
    renderMath(els.jonesOutput, "?");
  }
}

function renderWrithe(writhe) {
  if (writhe === null || writhe === undefined) {
    renderMath(els.writheOutput, "?");
    return;
  }

  renderMath(els.writheOutput, String(writhe));
}

function clearOutputs() {
  renderMath(els.writheOutput, "?");
  renderMath(els.bracketOutput, "-");
  renderMath(els.jonesOutput, "-");
}

function renderMath(element, texContent) {
  if (!element) return;

  element.innerHTML = `\\[${texContent}\\]`;
  queueMathTypeset();
}

let mathTypesetQueued = false;

function queueMathTypeset() {
  if (mathTypesetQueued) return;
  mathTypesetQueued = true;

  requestAnimationFrame(() => {
    mathTypesetQueued = false;

    if (!window.MathJax || !window.MathJax.typesetPromise) return;

    window.MathJax.typesetPromise().catch((error) => {
      console.error("MathJax typeset 실패:", error);
    });
  });
}

if (!els.canvas) {
  throw new Error("editor-canvas를 찾을 수 없다.");
}

const editor = createEditor(els.canvas, {
  mode: state.mode,
  onChange: handleEditorChange,
  onStatus: handleEditorStatus,
});

bindEvents();
updateModeButtons();
clearOutputs();
loadOptionalModules();

function escapeForMathJax(text) {
  return String(text).replace(/&/g, "\\&");
}