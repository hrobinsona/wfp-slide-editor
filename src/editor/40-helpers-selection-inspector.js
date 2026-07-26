  // ===========================================================================
  // Helpers
  // ===========================================================================
  function isInsideEditorRoot(el) {
    return !!el && root.contains(el);
  }

  function isPointInsideElementBox(el, x, y) {
    if (!el || getComputedStyle(el).display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  }

  function isPointInsidePassiveEditorSurface(e) {
    if (!e) return false;
    return (
      isPointInsideElementBox(toolbar, e.clientX, e.clientY) ||
      (
        inspectorDock.dataset.visible === 'true' &&
        isPointInsideElementBox(inspector, e.clientX, e.clientY)
      )
    );
  }

  function markResolvedRoot(resolvedRoot, mode) {
    if (!resolvedRoot) return;
    resolvedRoot.setAttribute('data-wfp-edit-deck-root', 'true');
    if (mode === 'flat') {
      resolvedRoot.setAttribute('data-wfp-edit-flat-root', 'true');
    }
  }

  function ensureFlatPositionContext(flatRoot) {
    if (!flatRoot) return;
    if (getComputedStyle(flatRoot).position === 'static') {
      flatRoot.setAttribute('data-wfp-edit-flat-position-context', 'true');
    }
  }

  function resolveNativeDeckRoot() {
    return document.querySelector('.deck');
  }

  function resolveForeignDeckRoot() {
    const counts = new Map();
    document.querySelectorAll('.slide').forEach((slide) => {
      const parent = slide.parentElement;
      if (!parent) return;
      counts.set(parent, (counts.get(parent) || 0) + 1);
    });

    let bestRoot = null;
    let bestCount = 0;
    counts.forEach((count, parent) => {
      if (count > bestCount) {
        bestRoot = parent;
        bestCount = count;
      }
    });
    return bestRoot;
  }

  function getFlatRootOverride() {
    const override = window.__WFP_EDIT_ROOT__;
    if (typeof override !== 'string' || !override.trim()) return null;
    try {
      const el = document.querySelector(override);
      return el instanceof Element ? el : null;
    } catch (_) {
      return null;
    }
  }

  function isDominantBodyWrapperCandidate(el) {
    if (!el || el.id === ROOT_ID) return false;
    return !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName);
  }

  function resolveFlatRoot() {
    const override = getFlatRootOverride();
    if (override) return override;
    const main = document.querySelector('main');
    if (main) return main;
    const article = document.querySelector('article');
    if (article) return article;
    const bodyChildren = [...document.body.children].filter(isDominantBodyWrapperCandidate);
    if (bodyChildren.length === 1) return bodyChildren[0];
    return document.body;
  }

  function resolveDeckRoot() {
    const nativeRoot = resolveNativeDeckRoot();
    if (nativeRoot) {
      markResolvedRoot(nativeRoot, 'native');
      return { mode: 'native', root: nativeRoot };
    }

    const foreignRoot = resolveForeignDeckRoot();
    if (foreignRoot) {
      markResolvedRoot(foreignRoot, 'foreign');
      return { mode: 'foreign', root: foreignRoot };
    }

    const flatRoot = resolveFlatRoot();
    markResolvedRoot(flatRoot, 'flat');
    ensureFlatPositionContext(flatRoot);
    return { mode: 'flat', root: flatRoot };
  }

  function getDocumentMode() {
    return deckContext.mode;
  }

  function isFlatMode() {
    return getDocumentMode() === 'flat';
  }

  function applyModeFeatureGating() {
    if (!isFlatMode()) return;
    overviewBtn.hidden = true;
    overviewBtn.disabled = true;
    overviewBtn.setAttribute('aria-hidden', 'true');
    overviewBtn.dataset.mode = 'off';
    toolbar.dataset.overviewMode = 'off';
  }

  function getDeckRoot() {
    return deckContext.root;
  }

  function getSlides() {
    const deckRoot = getDeckRoot();
    if (!deckRoot) return [];
    if (getDocumentMode() === 'flat') return [deckRoot];
    return [...deckRoot.querySelectorAll(':scope > .slide')];
  }

  function getActiveSlide() {
    if (getDocumentMode() === 'flat') return getDeckRoot();
    return getSlides().find((slide) => slide.classList.contains('active')) || null;
  }

  function findSelectableTarget(el) {
    if (!el || isInsideEditorRoot(el)) return null;
    const slide = getActiveSlide();
    if (!slide) return null;
    if (el === slide) return null;
    if (el === getDeckRoot()) return null;
    if (!slide.contains(el)) return null;
    return el;
  }

  function isSelectionToggleEvent(e) {
    return !!e && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  }

  function selectionArraysEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((el, i) => el === b[i]);
  }

  function normalizeSelectionElements(elements) {
    const slide = getActiveSlide();
    if (!slide) return [];
    const out = [];
    for (const el of elements || []) {
      if (!el || !el.isConnected || !slide.contains(el)) continue;
      if (el === slide || el === getDeckRoot()) continue;
      if (isInsideEditorRoot(el)) continue;
      if (!out.includes(el)) out.push(el);
    }
    return out;
  }

  function getSelectedElements() {
    const source = state.selectedElements && state.selectedElements.length
      ? state.selectedElements
      : (state.selected ? [state.selected] : []);
    return normalizeSelectionElements(source);
  }

  function hasMultiSelection() {
    return getSelectedElements().length > 1;
  }

  // ---------------------------------------------------------------------------
  // Bring to front (v2.17; stacking scope corrected in v2.17.1).
  //
  // v2.17 derived the required z from the target's SIBLINGS. That model is
  // wrong: z-order competes inside the nearest stacking-context ancestor, and
  // every intermediate stacking context caps what a descendant's z-index can
  // reach. On real decks Front therefore did nothing whenever the overlapping
  // element lived in another container (its container's z is what has to be
  // beaten), or whenever an ancestor of the target carried a transform (WFP
  // entrance animations do this constantly), which traps any z we write.
  //
  // So: the scope is the whole active slide — anything whose box actually
  // overlaps the target competes with it, wherever it sits in the tree — and
  // the result is checked against paint truth (elementsFromPoint) rather than
  // inferred from z values, because a capping ancestor can make a perfectly
  // correct z-index irrelevant.
  //
  // All rects here are viewport rects compared against other viewport rects,
  // and none of them is ever written back as a style value, so the deck's
  // transform: scale() never enters the maths (scale division applies only
  // when converting pointer deltas into slide pixels — this feature does no
  // such conversion).
  // ---------------------------------------------------------------------------
  // z-index is inert while position is static — the used value never
  // applies, so it must read as 0 both when this element IS the target
  // (an authored-but-inert z-index must not falsely look "already front")
  // and when it's a competitor being folded into the required max (an inert
  // z-index there must not inflate the plan).
  function effectiveZIndex(el) {
    if (getComputedStyle(el).position === 'static') return 0;
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    return Number.isFinite(z) ? z : 0; // auto (or garbage) reads as 0
  }

  // The z a competitor really defends is the highest one on its ancestor
  // chain, not its own: an ancestor's z-index carries its whole subtree, so a
  // z:auto element inside a z-index:5 container beats a z-index:1 element
  // outside it. Walk up to (but not including) the slide.
  function chainMaxZIndex(el, slide) {
    let max = 0;
    let node = el;
    while (node && node !== slide && slide.contains(node)) {
      max = Math.max(max, effectiveZIndex(node));
      node = node.parentElement;
    }
    return max;
  }

  function rectsOverlap(a, b) {
    return (
      Math.max(a.left, b.left) < Math.min(a.right, b.right) &&
      Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom)
    );
  }

  // Everything in the slide that visually overlaps `el`, minus the things it
  // makes no sense to compete with: editor chrome, anything that paints
  // nothing (a zero-area rect — wrapper divs whose children are all
  // absolutely positioned are the common case), and anything related by
  // containment to a target of this plan in either direction.
  //
  // "Either direction" is load-bearing. Descendants ride with their target,
  // and ancestors contain it — but the ancestors of a CO-target matter too:
  // the climb may raise one, and if it then counted as a competitor of
  // another target in the same plan, the next click would fold our own write
  // back into `required` and inflate the whole group ({3,4} -> {4,5} -> …).
  // Nothing is lost by dropping them, because whatever else lives inside
  // such an ancestor is still a competitor and still reports the ancestor's
  // z through chainMaxZIndex.
  function frontCompetitorsFor(el, targets, slide) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    const out = [];
    for (const node of slide.querySelectorAll('*')) {
      if (isInsideEditorRoot(node)) continue;
      if (targets.some((t) => t === node || t.contains(node) || node.contains(t))) continue;
      const nodeRect = node.getBoundingClientRect();
      if (nodeRect.width <= 0 || nodeRect.height <= 0) continue;
      if (!rectsOverlap(rect, nodeRect)) continue;
      out.push(node);
    }
    return out;
  }

  // Centre plus the four quarter points of the overlap. A lone centre sample
  // is easy to fool — a partial overlap, or a competitor whose middle is a
  // hole punched by a positioned child, both read as "not covered".
  function overlapSamplePoints(a, b) {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return [];
    const w = right - left;
    const h = bottom - top;
    return [
      { x: left + w / 2, y: top + h / 2 },
      { x: left + w / 4, y: top + h / 4 },
      { x: left + (w * 3) / 4, y: top + h / 4 },
      { x: left + w / 4, y: top + (h * 3) / 4 },
      { x: left + (w * 3) / 4, y: top + (h * 3) / 4 },
    ];
  }

  // Paint truth for one target/competitor pair. elementsFromPoint returns the
  // hit stack topmost-first, so whichever of the two shows up first is the
  // one actually painting on top; anything else at that point (a third
  // element, another co-target) is skipped rather than counted as a loss.
  //
  // Known blind spot, accepted: elements with pointer-events: none are
  // invisible to hit testing (the editor's own ring depends on that). We do
  // not try to compensate.
  function competitorPaintsAbove(target, competitor, points) {
    for (const point of points) {
      for (const node of document.elementsFromPoint(point.x, point.y)) {
        if (isInsideEditorRoot(node)) continue;
        if (node === target || target.contains(node)) break; // target wins here
        if (node === competitor || competitor.contains(node)) return true;
      }
    }
    return false;
  }

  function isTargetOccluded(el, competitors) {
    const rect = el.getBoundingClientRect();
    for (const competitor of competitors) {
      const points = overlapSamplePoints(rect, competitor.getBoundingClientRect());
      if (!points.length) continue;
      if (competitorPaintsAbove(el, competitor, points)) return true;
    }
    return false;
  }

  // Pragmatic stacking-context test: the cases that actually occur in slide
  // decks, not the full CSS list. Missing a real stacking context means the
  // climb skips past the ancestor that was actually capping us and raises a
  // larger subtree than necessary (or fails to resolve at all), so the list
  // errs towards including the common triggers.
  function establishesStackingContext(el) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'static' && cs.zIndex !== 'auto') return true;
    if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none') return true;
    if (cs.clipPath && cs.clipPath !== 'none') return true;
    if (parseFloat(cs.opacity) < 1) return true;
    if (/transform|opacity/.test(cs.willChange || '')) return true;
    if (cs.isolation === 'isolate') return true;
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return true;
    if (/\b(layout|paint|strict|content)\b/.test(cs.contain || '')) return true;
    return false;
  }

  // Is `cs` a containing block for absolutely-positioned descendants? Only
  // relevant for elements that are position: static, where the answer decides
  // whether we may promote them (see canRaiseAncestor).
  function establishesAbsoluteContainingBlock(cs) {
    return (
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      cs.perspective !== 'none' ||
      /transform|perspective|filter/.test(cs.willChange || '') ||
      /\b(layout|paint|strict|content)\b/.test(cs.contain || '')
    );
  }

  // "position: relative costs nothing" holds for an element's own box — it is
  // why the static fix-up on the TARGET is safe — but not for its subtree. A
  // static ancestor we promote becomes the containing block for every
  // absolutely-positioned descendant that used to resolve against something
  // further up, and they all jump. That is a silent relayout of the deck,
  // exported along with everything else, so we refuse: the dangerous set is
  // precisely the stacking-context triggers that are NOT also containing-block
  // triggers (opacity < 1, isolation, mix-blend-mode, will-change: opacity).
  // Leaving an occlusion unresolved is much cheaper than moving content, so
  // the climb skips such an ancestor and carries on outwards.
  function canRaiseAncestor(el) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'static') return true;
    return establishesAbsoluteContainingBlock(cs);
  }

  // Nearest-first, strictly below the slide. Captured BEFORE any write:
  // raising an ancestor turns it into a stacking context itself, which would
  // otherwise grow the very chain we are walking.
  function stackingContextAncestors(el, slide) {
    const chain = [];
    let node = el.parentElement;
    while (node && node !== slide && slide.contains(node)) {
      if (establishesStackingContext(node)) chain.push(node);
      node = node.parentElement;
    }
    return chain;
  }

  // DOM-order tiebreak for equal effective z: the element that comes later
  // in the document currently paints on top, so it sorts after — a bump
  // then preserves that relative order instead of collapsing ties.
  function compareStackOrder(a, b) {
    const za = effectiveZIndex(a);
    const zb = effectiveZIndex(b);
    if (za !== zb) return za - zb;
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  // One shared counter above the highest z any competitor defends, assigned
  // in current-stack order so a multi-select bump keeps the targets' relative
  // order (required + 1, required + 2, …) instead of tying them.
  //
  // Multi-target input is currently unreachable through the UI — the
  // inspector dock (and this action row with it) only renders while
  // exactly one element is selected, so a real pointer click can never
  // land on this button during a multi-selection. The multi-target path
  // is kept correct anyway as deliberate forward-compat for whenever
  // multi-select gets its own surface; tests exercise it by dispatching
  // the click event directly rather than driving a real (unreachable)
  // pointer click.
  function computeFrontPlan(elements) {
    const slide = getActiveSlide();
    if (!slide) return null;
    const scoped = [...elements].filter((el) => el && el.isConnected && slide.contains(el));
    if (!scoped.length) return null;
    const ordered = scoped.sort(compareStackOrder);
    let required = 0;
    const entries = ordered.map((el) => {
      const competitors = frontCompetitorsFor(el, ordered, slide);
      for (const competitor of competitors) {
        required = Math.max(required, chainMaxZIndex(competitor, slide));
      }
      return { el, competitors, z: 0 };
    });
    entries.forEach((entry, i) => { entry.z = required + 1 + i; });
    return { slide, entries };
  }

  // No-op guard (v2.17.1: paint truth, not a z comparison). An element can
  // carry a huge z-index and still be buried, because a capping ancestor
  // swallows it — so "already high enough" is not evidence of anything and
  // the sampling has to run first.
  //
  // The planned-z check is kept as a second, independent condition: an
  // element with no overlapping competitor at all is trivially "painting
  // above all of them", and Front on it should still do the obvious thing
  // (give it an explicit z-index) rather than silently nothing. Both
  // conditions must hold for a click to be dropped, which is what keeps
  // repeated clicks from inflating z or pushing history entries.
  function isFrontPlanNoop(plan) {
    return plan.entries.every(({ el, z, competitors }) => (
      effectiveZIndex(el) >= z && !isTargetOccluded(el, competitors)
    ));
  }

  // z-index is inert on position: static, so a raised element is promoted to
  // position: relative first — no offsets are written, so the element's own
  // box does not move. (Its abs-positioned DESCENDANTS can re-anchor, which
  // is why ancestors go through canRaiseAncestor first; on the target itself
  // this is the long-standing v2.17 fix-up.) Never demotes: an element
  // already sitting above the requested z keeps it. touchElement() must run
  // before either write lands.
  function raiseElementZIndex(el, z) {
    if (effectiveZIndex(el) >= z) return;
    touchElement(el);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.zIndex = String(z);
  }

  function applyFrontPlan(plan) {
    const chains = new Map();
    for (const { el } of plan.entries) {
      chains.set(el, stackingContextAncestors(el, plan.slide));
    }

    for (const { el, z } of plan.entries) raiseElementZIndex(el, z);

    // Verify and climb. A correct z-index is inert inside a capping ancestor
    // (transform, opacity < 1, an own z-index, …), so when the target still
    // paints below a competitor we raise the nearest such ancestor as well,
    // then the next one out, re-checking after each step. Bounded by the
    // ancestor chain, which was captured before any of these writes.
    //
    // Raising a container carries its whole subtree forward. That is
    // unavoidable — it is precisely what "in front" means for a nested
    // element — and it is why we climb only as far as the occlusion needs.
    const raisedAncestors = new Map();
    for (const { el, z, competitors } of plan.entries) {
      if (!isTargetOccluded(el, competitors)) continue;
      for (const ancestor of chains.get(el)) {
        if (!canRaiseAncestor(ancestor)) continue;
        // Dedupe across targets by keeping the highest request per ancestor;
        // the climb still advances either way, so a shared ancestor can't
        // stall the loop.
        if ((raisedAncestors.get(ancestor) || 0) < z) {
          raisedAncestors.set(ancestor, z);
          raiseElementZIndex(ancestor, z);
        }
        if (!isTargetOccluded(el, competitors)) break;
      }
    }
  }

  function toggleSelectedElement(target) {
    if (!target) return;
    const current = getSelectedElements();
    const existingIndex = current.indexOf(target);
    let next;
    let primary = target;
    if (existingIndex >= 0) {
      next = current.filter((el) => el !== target);
      primary = next[next.length - 1] || null;
    } else {
      next = current.filter((el) => !el.contains(target) && !target.contains(el));
      next.push(target);
    }
    setSelectedElements(next, primary);
  }

  function stripEditorArtifactsFrom(el) {
    if (!el) return;
    const nodes = [el, ...el.querySelectorAll('*')];
    for (const node of nodes) {
      for (const attr of [...node.attributes]) {
        if (
          attr.name.startsWith('data-wfp-edit') ||
          attr.name === HANDOFF_TARGET_ATTR ||
          attr.name === HANDOFF_SCRIPT_ATTR
        ) {
          node.removeAttribute(attr.name);
        }
      }
      if (node.hasAttribute('contenteditable')) node.removeAttribute('contenteditable');
    }
  }

  function collectEditorDataAttributes(el) {
    const attrs = {};
    if (!el || !el.attributes) return attrs;
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('data-wfp-edit')) attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  function applyEditorDataAttributes(el, attrs) {
    if (!el) return;
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('data-wfp-edit')) el.removeAttribute(attr.name);
    }
    for (const [name, value] of Object.entries(attrs || {})) {
      el.setAttribute(name, value);
    }
  }

  function editorDataAttributesEqual(a, b) {
    const aKeys = Object.keys(a || {}).sort();
    const bKeys = Object.keys(b || {}).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
  }

  function normalizeAnnotationText(raw) {
    return typeof raw === 'string' ? raw.trim() : '';
  }

  function getAnnotationId(el) {
    return el ? (el.getAttribute(ANNOTATION_ID_ATTR) || '') : '';
  }

  function getAnnotationText(el) {
    return normalizeAnnotationText(el ? el.getAttribute(ANNOTATION_TEXT_ATTR) : '');
  }

  function hasAnnotation(el) {
    return !!getAnnotationId(el) && !!getAnnotationText(el);
  }

  function generateAnnotationId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `ann-${time}-${rand}`;
  }

  function getAnnotatedElements(rootNode = document) {
    const rootEl = rootNode.documentElement || rootNode;
    const nodes = rootEl ? [...rootEl.querySelectorAll(`[${ANNOTATION_ID_ATTR}][${ANNOTATION_TEXT_ATTR}]`)] : [];
    return nodes.filter((el) => hasAnnotation(el));
  }

  function findAnnotationElementById(id) {
    if (!id) return null;
    return getAnnotatedElements(document).find((el) => getAnnotationId(el) === id) || null;
  }

  function updateAnnotationDraftStatus(el) {
    if (!annotationStatus) return;
    const visible = !!el && getSelectedElements().length === 1;
    if (!visible) {
      annotationRow.dataset.hasNote = 'false';
      annotationRow.dataset.dirty = 'false';
      annotationStatus.textContent = '';
      return;
    }
    const savedText = getAnnotationText(el);
    const draftText = normalizeAnnotationText(annotationTextarea.value);
    const hasSaved = hasAnnotation(el);
    const dirty = draftText !== savedText;
    annotationRow.dataset.hasNote = hasSaved ? 'true' : 'false';
    annotationRow.dataset.dirty = dirty ? 'true' : 'false';
    if (dirty) {
      annotationStatus.textContent = draftText ? 'Unsaved' : (hasSaved ? 'Will delete' : '');
    } else {
      annotationStatus.textContent = hasSaved ? 'Saved' : '';
    }
  }

  function autoGrowAnnotationTextarea() {
    const minHeight = 52;
    // The textarea has a content cap; viewport pressure is handled by the
    // inspector body's live `100vh` scroll bound rather than a guessed
    // subtraction that cannot account for agent-reply blocks.
    const maxHeight = 112;
    annotationTextarea.style.height = 'auto';
    // scrollHeight excludes the border while height is border-box; include
    // the 1px top/bottom borders so the last line is never clipped by 2px.
    const naturalHeight = Math.max(minHeight, annotationTextarea.scrollHeight + 2);
    const nextHeight = Math.min(maxHeight, naturalHeight);
    annotationTextarea.style.height = `${nextHeight}px`;
    annotationTextarea.style.overflowY = naturalHeight > nextHeight ? 'auto' : 'hidden';
  }

  function getAnnotationEditorTarget() {
    const selected = getSelectedElements();
    if (
      selected.length === 1 &&
      selected[0] &&
      selected[0].isConnected &&
      !state.overviewMode
    ) {
      return selected[0];
    }
    return (
      annotationRow.__wfpeTarget &&
      annotationRow.__wfpeTarget.isConnected
    ) ? annotationRow.__wfpeTarget : null;
  }

  function isAnnotationMarkerVisibleFor(el, activeSlide) {
    if (!el || !el.isConnected || isInsideEditorRoot(el)) return false;
    const slide = el.closest('.slide');
    if (activeSlide && slide && slide !== activeSlide) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    return rect.right >= 0 && rect.bottom >= 0 && rect.left <= window.innerWidth && rect.top <= window.innerHeight;
  }

  function positionAnnotationBadge(marker, rect) {
    // Fixed-layer equivalent of the 6b reference's in-element anchor
    // (top: -6, right: -6 on a 13px dot): the dot straddles the element's
    // top-right corner, pushed 6px out on both axes.
    const markerWidth = 13;
    const markerHeight = 13;
    const left = Math.max(4, Math.min(window.innerWidth - markerWidth - 4, rect.right - markerWidth + 6));
    const preferredTop = rect.top - 6;
    const top = preferredTop >= 4 ? preferredTop : Math.min(window.innerHeight - markerHeight - 4, rect.top + 4);
    marker.style.left = `${left}px`;
    marker.style.top = `${Math.max(4, top)}px`;
  }

  // All elements bearing a saved annotation, regardless of current
  // visibility (has a note, but not necessarily connected / on the active
  // slide / on screen). getAnnotatedElements(document) is the expensive
  // part — a document-wide attribute query — and refreshAnnotationMarkers()
  // below is the only place that re-runs it, caching the unfiltered result
  // on state.annotatedElementsCache (see 10-state.js for why it lives on
  // state rather than a module let) so the idle selection-tracking tick
  // (further down) never queries the document itself; it just re-checks
  // each already-known element's current visibility and rect.
  function refreshAnnotationMarkers() {
    if (!annotationLayer) return;
    if (!state.editMode || state.overviewMode) {
      annotationLayer.replaceChildren();
      state.annotatedElementsCache = [];
      return;
    }
    const activeSlide = getActiveSlide();
    state.annotatedElementsCache = getAnnotatedElements(document);
    const annotated = state.annotatedElementsCache.filter((el) => isAnnotationMarkerVisibleFor(el, activeSlide));
    const existing = new Map(
      [...annotationLayer.querySelectorAll('.wfpe-annotation-badge')]
        .map((marker) => [marker.dataset.annotationId || '', marker])
    );
    const used = new Set();
    for (const el of annotated) {
      const id = getAnnotationId(el);
      const rect = el.getBoundingClientRect();
      let marker = existing.get(id);
      if (!marker) {
        marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'wfpe-annotation-badge';
        marker.dataset.annotationId = id;
        marker.setAttribute('aria-label', 'Agent note');
        annotationLayer.appendChild(marker);
      }
      marker.dataset.selected = el === state.selected ? 'true' : 'false';
      const status = el.getAttribute(ANNOTATION_STATUS_ATTR);
      if (status) marker.dataset.status = status;
      else delete marker.dataset.status;
      marker.textContent = '';
      const reply = normalizeAnnotationText(el.getAttribute(ANNOTATION_REPLY_ATTR));
      marker.title = reply ? `${getAnnotationText(el)} — Agent: ${reply}` : getAnnotationText(el);
      positionAnnotationBadge(marker, rect);
      used.add(marker);
    }
    for (const marker of existing.values()) {
      if (!used.has(marker)) marker.remove();
    }
  }

  function saveAnnotation(targetEl, rawText) {
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el || hasMultiSelection() || state.overviewMode) return false;
    const nextText = normalizeAnnotationText(rawText);
    const currentText = getAnnotationText(el);
    const currentId = getAnnotationId(el);
    if (!nextText && !currentText && !currentId) return false;
    if (nextText && currentText === nextText && currentId) return false;

    const ctx = startInspectorTxn();
    touchElement(el);
    if (!nextText) {
      el.removeAttribute(ANNOTATION_ID_ATTR);
      el.removeAttribute(ANNOTATION_TEXT_ATTR);
    } else {
      el.setAttribute(ANNOTATION_ID_ATTR, currentId || generateAnnotationId());
      el.setAttribute(ANNOTATION_TEXT_ATTR, nextText);
    }
    // A changed or deleted instruction supersedes the agent's reply to the
    // old one (v2.13). Same transaction, so undo restores them together.
    el.removeAttribute(ANNOTATION_STATUS_ATTR);
    el.removeAttribute(ANNOTATION_REPLY_ATTR);
    endInspectorTxn(ctx);
    populateAnnotation(el, { force: true });
    refreshExportUi();
    // refreshExportUi() -> refreshAnnotationMarkers() just refreshed
    // annotatedElementsCache; recapture the idle-tracking baseline now so
    // the new/changed annotation is tracked immediately rather than only
    // after the next unrelated full refresh.
    startSelectionTracking();
    showToast(el, nextText ? 'Agent note saved.' : 'Agent note deleted.');
    return true;
  }

  function deleteAnnotation(targetEl) {
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el || (!getAnnotationId(el) && !getAnnotationText(el))) return false;
    const ctx = startInspectorTxn();
    touchElement(el);
    el.removeAttribute(ANNOTATION_ID_ATTR);
    el.removeAttribute(ANNOTATION_TEXT_ATTR);
    el.removeAttribute(ANNOTATION_STATUS_ATTR);
    el.removeAttribute(ANNOTATION_REPLY_ATTR);
    endInspectorTxn(ctx);
    populateAnnotation(el, { force: true });
    refreshExportUi();
    startSelectionTracking(); // keep the idle-tracking baseline current — see saveAnnotation
    showToast(el, 'Agent note deleted.');
    return true;
  }

  function populateAnnotation(el, options = {}) {
    const visible = !!el && getSelectedElements().length === 1;
    annotationRow.style.display = visible ? '' : 'none';
    if (!visible) {
      annotationRow.__wfpeTarget = null;
      if (document.activeElement !== annotationTextarea) annotationTextarea.value = '';
      annotationDeleteBtn.disabled = true;
      updateAnnotationDraftStatus(null);
      renderAnnotationReply(null);
      autoGrowAnnotationTextarea();
      return;
    }
    const targetChanged = annotationRow.__wfpeTarget !== el;
    const preserveDraft = (
      !options.force &&
      !targetChanged &&
      annotationRow.dataset.dirty === 'true'
    );
    annotationRow.__wfpeTarget = el;
    const text = getAnnotationText(el);
    if (options.force || targetChanged || (!preserveDraft && document.activeElement !== annotationTextarea)) {
      annotationTextarea.value = text;
    }
    autoGrowAnnotationTextarea();
    annotationDeleteBtn.disabled = !hasAnnotation(el);
    updateAnnotationDraftStatus(el);
    renderAnnotationReply(el);
    positionInspectorStack();
  }

  // Read-only "Agent …" line under the note textarea (v2.13): shows the
  // agent's reply for skipped / needs-input notes, hidden otherwise.
  function renderAnnotationReply(el) {
    const status = el ? (el.getAttribute(ANNOTATION_STATUS_ATTR) || '') : '';
    if (!status) {
      annotationReply.textContent = '';
      annotationReply.dataset.status = '';
      annotationReply.style.display = 'none';
      return;
    }
    const label = status === 'needs-input' ? 'Agent needs input' : 'Agent skipped';
    const reply = normalizeAnnotationText(el.getAttribute(ANNOTATION_REPLY_ATTR));
    annotationReply.textContent = reply ? `${label}: ${reply}` : `${label}.`;
    annotationReply.dataset.status = status;
    annotationReply.style.display = '';
  }

  function refreshExportUi() {
    const count = getAnnotatedElements(document).length;
    exportBadge.dataset.count = String(count);
    exportBadge.textContent = count > 0 ? String(count) : '';
    const label = exportPrimaryItem.querySelector('.wfpe-export-menu-label');
    const sub = exportPrimaryItem.querySelector('.wfpe-export-menu-sub');
    if (count > 0) {
      label.textContent = 'Annotated copy';
      sub.textContent = `Includes ${count} agent note${count === 1 ? '' : 's'}`;
    } else {
      label.textContent = 'Save';
      sub.textContent = 'Edits only';
    }
    if (!canSaveInPlace()) {
      sub.textContent += ' — Downloads';
    }
    const cleanLabel = exportCleanItem.querySelector('.wfpe-export-menu-label');
    const cleanSub = exportCleanItem.querySelector('.wfpe-export-menu-sub');
    cleanLabel.textContent = 'Clean copy';
    cleanSub.textContent = count > 0 ? 'Edits only — notes stripped' : 'Download a copy';
    refreshAnnotationMarkers();
  }

  function parseHandoffPayload() {
    const script = document.querySelector(`script[${HANDOFF_SCRIPT_ATTR}]`);
    if (!script) return null;
    try {
      const payload = JSON.parse(script.textContent || '{}');
      return payload && Array.isArray(payload.annotations) ? payload : null;
    } catch (_) {
      return null;
    }
  }

  function getHandoffTargetsById(rootNode, id) {
    if (!id) return [];
    const rootEl = rootNode.documentElement || rootNode;
    return [...rootEl.querySelectorAll(`[${HANDOFF_TARGET_ATTR}]`)]
      .filter((el) => el.getAttribute(HANDOFF_TARGET_ATTR) === id);
  }

  function removeHandoffArtifacts(rootNode) {
    const rootEl = rootNode.documentElement || rootNode;
    if (!rootEl) return;
    rootEl.querySelectorAll(`script[${HANDOFF_SCRIPT_ATTR}]`).forEach((script) => script.remove());
    rootEl.querySelectorAll(`script[${RESULTS_SCRIPT_ATTR}]`).forEach((script) => script.remove());
    [rootEl, ...rootEl.querySelectorAll('*')].forEach((el) => {
      if (el.hasAttribute && el.hasAttribute(HANDOFF_TARGET_ATTR)) el.removeAttribute(HANDOFF_TARGET_ATTR);
      // v2.14 — edit-ledger anchors left behind by agent-processed files.
      // The handoff build re-stamps fresh ids on the clone after this pass.
      if (el.hasAttribute && el.hasAttribute(EDIT_LEDGER_TARGET_ATTR)) el.removeAttribute(EDIT_LEDGER_TARGET_ATTR);
    });
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_COMMENT);
    const comments = [];
    let node = walker.nextNode();
    while (node) {
      if ((node.nodeValue || '').includes('WFP Editor handoff:')) comments.push(node);
      node = walker.nextNode();
    }
    comments.forEach((comment) => comment.remove());
  }

  // Parses the agent's results block (v2.13). Returns null when absent or
  // malformed; otherwise a per-id map plus counts for the summary toast.
  function parseAgentResults() {
    const script = document.querySelector(`script[${RESULTS_SCRIPT_ATTR}]`);
    if (!script) return null;
    try {
      const payload = JSON.parse(script.textContent || '{}');
      if (!payload || !Array.isArray(payload.results)) return null;
      const byId = new Map();
      const counts = { done: 0, skipped: 0, needsInput: 0 };
      for (const entry of payload.results) {
        const id = (entry && typeof entry.id === 'string') ? entry.id : '';
        const status = entry && entry.status;
        if (!id || byId.has(id)) continue;
        if (status !== 'done' && status !== 'skipped' && status !== 'needs-input') continue;
        byId.set(id, { status, note: normalizeAnnotationText(entry.note) });
        if (status === 'done') counts.done += 1;
        else if (status === 'skipped') counts.skipped += 1;
        else counts.needsInput += 1;
      }
      return byId.size ? { byId, counts } : null;
    } catch (_) {
      return null;
    }
  }

  function reimportHandoffAnnotations() {
    const payload = parseHandoffPayload();
    const results = parseAgentResults();
    if (results) state.agentResultsSummary = results.counts;
    if (!payload && !results) return;
    if (payload) {
      for (const annotation of payload.annotations) {
        const id = typeof annotation.id === 'string' ? annotation.id : '';
        const instruction = normalizeAnnotationText(annotation.instruction);
        if (!id || !instruction) continue;
        const result = results ? results.byId.get(id) : null;
        // A done result resolves the note even if the agent left the
        // metadata in place — stale annotations must not re-import.
        if (result && result.status === 'done') continue;
        const targets = getHandoffTargetsById(document, id);
        if (!targets.length) continue;
        for (const target of targets) {
          target.setAttribute(ANNOTATION_ID_ATTR, id);
          target.setAttribute(ANNOTATION_TEXT_ATTR, instruction);
          if (result) {
            target.setAttribute(ANNOTATION_STATUS_ATTR, result.status);
            if (result.note) target.setAttribute(ANNOTATION_REPLY_ATTR, result.note);
          }
        }
      }
    }
    removeHandoffArtifacts(document);
  }

  // Toasts the reconciliation summary once, at ready. Covers both the live
  // refresh and a manual reopen of an agent-processed file.
  function consumeAgentResultsSummaryToast() {
    const counts = state.agentResultsSummary;
    state.agentResultsSummary = null;
    if (!counts) return;
    const parts = [];
    if (counts.done) parts.push(`${counts.done} done`);
    if (counts.skipped) parts.push(`${counts.skipped} skipped`);
    if (counts.needsInput) parts.push(`${counts.needsInput} needs input`);
    if (!parts.length) return;
    showToast(document.body, `Agent update: ${parts.join(', ')}.`);
  }

  function getCoordinateRootForElement(el) {
    const slide = el.closest('.slide');
    if (slide && getDeckRoot() && getDeckRoot().contains(slide)) return slide;
    const activeSlide = getActiveSlide();
    if (activeSlide && activeSlide.contains(el)) return activeSlide;
    return getDeckRoot();
  }

  function getSlideBox(el) {
    const coordinateRoot = getCoordinateRootForElement(el);
    const scale = getCanvasScale();
    const elRect = el.getBoundingClientRect();
    const slideRect = coordinateRoot ? coordinateRoot.getBoundingClientRect() : { left: 0, top: 0 };
    const safeScale = scale || 1;
    return {
      left: (elRect.left - slideRect.left) / safeScale,
      top: (elRect.top - slideRect.top) / safeScale,
      width: elRect.width / safeScale,
      height: elRect.height / safeScale,
    };
  }

  function applyExplicitSizeConstraints(el, size) {
    const cs = getComputedStyle(el);
    if (Number.isFinite(size.width)) {
      const maxWidth = parseFloat(cs.maxWidth);
      if (cs.maxWidth !== 'none' && Number.isFinite(maxWidth) && size.width > maxWidth) {
        el.style.maxWidth = 'none';
      }
      const minWidth = parseFloat(cs.minWidth);
      if (Number.isFinite(minWidth) && size.width < minWidth) {
        el.style.minWidth = '0px';
      }
    }
    if (Number.isFinite(size.height)) {
      const maxHeight = parseFloat(cs.maxHeight);
      if (cs.maxHeight !== 'none' && Number.isFinite(maxHeight) && size.height > maxHeight) {
        el.style.maxHeight = 'none';
      }
      const minHeight = parseFloat(cs.minHeight);
      if (Number.isFinite(minHeight) && size.height < minHeight) {
        el.style.minHeight = '0px';
      }
    }
  }

  function serializeElementForClipboard(el) {
    const clone = el.cloneNode(true);
    stripEditorArtifactsFrom(clone);
    const box = getSlideBox(el);
    const computed = getComputedStyle(el);
    const contentWidth = parseFloat(computed.width);
    const contentHeight = parseFloat(computed.height);
    const width = computed.boxSizing === 'border-box'
      ? box.width
      : (Number.isFinite(contentWidth) ? contentWidth : box.width);
    const height = computed.boxSizing === 'border-box'
      ? box.height
      : (Number.isFinite(contentHeight) ? contentHeight : box.height);
    clone.style.position = 'absolute';
    clone.style.left = `${box.left}px`;
    clone.style.top = `${box.top}px`;
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    return clone.outerHTML;
  }

  function copySelectedElement() {
    const el = state.selected;
    if (hasMultiSelection()) return false;
    if (!el || !el.isConnected) return false;
    state.clipboard = { outerHTML: serializeElementForClipboard(el) };
    return true;
  }

  function parseClipboardElement() {
    if (!state.clipboard || !state.clipboard.outerHTML) return null;
    const template = document.createElement('template');
    template.innerHTML = state.clipboard.outerHTML.trim();
    const el = template.content.firstElementChild;
    if (!el) return null;
    stripEditorArtifactsFrom(el);
    return el;
  }

  function pasteClipboardElement() {
    const slide = getActiveSlide();
    if (!slide) return false;
    const inserted = parseClipboardElement();
    if (!inserted) return false;
    const left = parseFloat(inserted.style.left);
    const top = parseFloat(inserted.style.top);
    inserted.style.position = 'absolute';
    inserted.style.left = `${(Number.isFinite(left) ? left : 0) + 20}px`;
    inserted.style.top = `${(Number.isFinite(top) ? top : 0) + 20}px`;

    const previousSelectedEl = (
      state.selected &&
      state.selected.isConnected &&
      slide.contains(state.selected)
    ) ? state.selected : null;
    slide.appendChild(inserted);
    pushElementInsertEntry({
      type: 'elementInsert',
      slideEl: slide,
      insertedEl: inserted,
      parentEl: slide,
      nextSiblingEl: null,
      previousSelectedEl,
    });
    setSelected(inserted);
    refreshInspector();
    return true;
  }

  function duplicateSelected() {
    if (state.editingText) endTextEdit();
    if (!copySelectedElement()) return false;
    return pasteClipboardElement();
  }

  function deleteSelectedElement() {
    if (state.editingText) endTextEdit();
    if (hasMultiSelection()) return false;
    const el = state.selected;
    if (!el || !el.isConnected || state.overviewMode) return false;
    const parent = el.parentElement;
    const slide = getCoordinateRootForElement(el);
    if (!parent || !slide || !slide.contains(el)) return false;
    const nextSibling = el.nextSibling;
    parent.removeChild(el);
    pushElementInsertEntry({
      type: 'elementDelete',
      slideEl: slide,
      deletedEl: el,
      parentEl: parent,
      nextSiblingEl: nextSibling,
    });
    setSelected(null);
    refreshInspector();
    return true;
  }

  function positionRing(el) {
    const rect = el.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.top = `${rect.top}px`;
    ring.style.left = `${rect.left}px`;
    ring.style.width = `${rect.width}px`;
    ring.style.height = `${rect.height}px`;
    positionHandles(rect);
  }

  function hideRing() {
    ring.style.display = 'none';
    hideHandles();
  }

  function handleAnchors(rect) {
    return {
      nw: { x: rect.left, y: rect.top },
      n: { x: rect.left + rect.width / 2, y: rect.top },
      ne: { x: rect.left + rect.width, y: rect.top },
      e: { x: rect.left + rect.width, y: rect.top + rect.height / 2 },
      se: { x: rect.left + rect.width, y: rect.top + rect.height },
      s: { x: rect.left + rect.width / 2, y: rect.top + rect.height },
      sw: { x: rect.left, y: rect.top + rect.height },
      w: { x: rect.left, y: rect.top + rect.height / 2 },
    };
  }

  function positionHandles(rect) {
    const anchors = handleAnchors(rect);
    // Use the known handle size per direction so we don't need to read
    // offsetWidth (which would force a layout flush every drag tick).
    for (const dir of HANDLE_DIRS) {
      const a = anchors[dir];
      const h = handles[dir];
      const half = handleSizeFor(dir) / 2;
      h.style.left = `${a.x - half}px`;
      h.style.top = `${a.y - half}px`;
      h.style.display = 'block';
    }
  }

  function hideHandles() {
    for (const dir of HANDLE_DIRS) handles[dir].style.display = 'none';
  }

  function refreshSelection() {
    if (state.editingText) {
      // The selection ring (and the dimension bubble) sitting over a
      // contenteditable target steals visual attention from the caret.
      // Hide both for the duration of the text edit; refreshSelection
      // will re-show them once edit ends.
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      refreshAnnotationMarkers();
      stopSelectionTracking();
      return;
    }
    if (clearDisconnectedSelection()) return;
    const members = getSelectedElements();
    if (members.length > 1) {
      hideRing();
      hideHandles();
      hideDimBubble();
      positionMultiSelection(members);
      populateInspector(null);
      refreshAnnotationMarkers();
      startSelectionTracking();
    } else if (members.length === 1) {
      hideMultiSelection();
      state.selected = members[0];
      state.selectedElements = members;
      positionRing(state.selected);
      positionDimBubble(state.selected);
      populateInspector(state.selected);
      if (!state.drag && !state.resize && !state.txn && !state.editingText) {
        positionInspectorStack();
      }
      refreshAnnotationMarkers();
      startSelectionTracking();
    } else {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      refreshAnnotationMarkers();
      stopSelectionTracking();
    }
  }

  function positionDimBubble(el) {
    const r = el.getBoundingClientRect();
    // Use offsetWidth/Height (unscaled slide coords) so the bubble matches
    // the inspector's W/H readout. r.width/height are post-`transform: scale()`
    // viewport pixels and would diverge from the inline-style values.
    dimBubble.textContent = `${el.offsetWidth} × ${el.offsetHeight}`;
    // v2.12: while the live value tag owns the readout, keep the text
    // tracking (v2-2 reads textContent right after a resize gesture) but
    // yield the pixels to the coral tag.
    dimBubble.style.display = isScrubTagVisible() ? 'none' : 'block';
    // Anchor the bubble centred above the ring with a small gutter; the
    // chip's own height is small (~22px) so a 22px offset clears the
    // ring's stroke without floating off the screen for top-edge selections.
    const top = Math.max(2, r.top - 22);
    const left = r.left + r.width / 2;
    dimBubble.style.top = `${top}px`;
    dimBubble.style.left = `${left}px`;
  }

  function hideDimBubble() {
    dimBubble.style.display = 'none';
  }

  function hideMultiSelection() {
    multiBox.style.display = 'none';
    multiOutlineLayer.replaceChildren();
  }

  function positionMultiSelection(elements) {
    const rects = elements
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0);
    if (!rects.length) {
      hideMultiSelection();
      return;
    }
    const bounds = rects.reduce((acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }), {
      left: rects[0].left,
      top: rects[0].top,
      right: rects[0].right,
      bottom: rects[0].bottom,
    });

    multiBox.style.display = 'block';
    multiBox.style.left = `${bounds.left}px`;
    multiBox.style.top = `${bounds.top}px`;
    multiBox.style.width = `${bounds.right - bounds.left}px`;
    multiBox.style.height = `${bounds.bottom - bounds.top}px`;

    multiOutlineLayer.replaceChildren();
    for (const r of rects) {
      const outline = document.createElement('div');
      outline.className = 'wfpe-multi-outline';
      outline.style.display = 'block';
      outline.style.left = `${r.left}px`;
      outline.style.top = `${r.top}px`;
      outline.style.width = `${r.width}px`;
      outline.style.height = `${r.height}px`;
      multiOutlineLayer.appendChild(outline);
    }
  }

  let selectionRafId = 0;
  // Rects captured right after the most recent full refresh, used by the
  // idle tick below to detect whether anything actually moved before
  // paying for another full refresh. Null while nothing is tracked.
  let selectionTrackingSnapshot = null;

  function shouldTrackSelection() {
    return (
      state.editMode &&
      !state.overviewMode &&
      !state.editingText &&
      getSelectedElements().length > 0
    );
  }

  function stopSelectionTracking() {
    selectionTrackingSnapshot = null;
    if (!selectionRafId) return;
    cancelAnimationFrame(selectionRafId);
    selectionRafId = 0;
  }

  // ---------------------------------------------------------------------------
  // Idle-tick dirty check (perf).
  //
  // Every frame while an element sits selected, this loop used to re-run
  // the FULL refreshSelection() path — getComputedStyle reads, inspector
  // input writes, autoGrowAnnotationTextarea's two forced reflows,
  // positionInspectorStack's offset reads, and a document-wide annotation
  // marker query — even when nothing had moved. That's continuous layout
  // work for as long as anything stays selected.
  //
  // refreshSelection() itself and every event-driven call site (click,
  // drag/resize commit, undo/redo, slide change, inspector commits, the
  // v2.12 gesture fade, etc.) are untouched — those still force a full
  // refresh immediately, exactly as before. Only the idle rAF loop gets
  // cheaper: each tick just re-checks the selected element(s) and every
  // known-annotated element's visibility + rect against the values cached
  // from the last full refresh (no document query — annotatedElementsCache
  // above already has the element list). Nothing changed → reschedule and
  // do no other work. Something changed (the selection moved, a
  // no-selection-change host animation moved/revealed/hid an annotated
  // element) → run the full refreshSelection() exactly as before, which
  // recaptures the baseline for the next tick. This is deliberately
  // geometry-only: a host script changing a non-geometric style (e.g.
  // opacity, colour, font-size) directly, with no rect/visibility change
  // and no editor event, will not refresh the inspector's readouts until
  // something else triggers a full refresh.
  // ---------------------------------------------------------------------------
  function rectsRoughlyEqual(a, b) {
    return (
      Math.abs(a.left - b.left) < 0.1 &&
      Math.abs(a.top - b.top) < 0.1 &&
      Math.abs(a.width - b.width) < 0.1 &&
      Math.abs(a.height - b.height) < 0.1
    );
  }

  // Tracks EVERY known-annotated element (not just the currently-visible
  // ones) with its own visibility verdict, so an element that is revealed
  // (or hidden) by host code with no other geometry change still flips
  // the check below — not just elements that were already on screen.
  function captureSelectionTrackingSnapshot() {
    const activeSlide = getActiveSlide();
    return {
      members: getSelectedElements().map((el) => ({ el, rect: el.getBoundingClientRect() })),
      annotated: state.annotatedElementsCache.map((el) => {
        const visible = el.isConnected && isAnnotationMarkerVisibleFor(el, activeSlide);
        return { el, visible, rect: visible ? el.getBoundingClientRect() : null };
      }),
    };
  }

  function selectionTrackingSnapshotIsStale(snapshot, members) {
    if (!snapshot) return true;
    if (members.length !== snapshot.members.length) return true;
    for (let i = 0; i < members.length; i++) {
      const cached = snapshot.members[i];
      if (members[i] !== cached.el || !rectsRoughlyEqual(members[i].getBoundingClientRect(), cached.rect)) {
        return true;
      }
    }
    const activeSlide = getActiveSlide();
    for (const entry of snapshot.annotated) {
      const visible = entry.el.isConnected && isAnnotationMarkerVisibleFor(entry.el, activeSlide);
      if (visible !== entry.visible) return true;
      if (visible && !rectsRoughlyEqual(entry.el.getBoundingClientRect(), entry.rect)) return true;
    }
    return false;
  }

  function startSelectionTracking() {
    if (!shouldTrackSelection()) return;
    // Always refresh the baseline, even if a frame is already scheduled.
    // Event-driven refreshes (e.g. every tick of a drag) call this too;
    // without an unconditional recapture here, the idle loop's next tick
    // would keep comparing against a pre-gesture snapshot and force one
    // redundant extra full refresh right after the gesture ends.
    selectionTrackingSnapshot = captureSelectionTrackingSnapshot();
    if (selectionRafId) return;
    selectionRafId = requestAnimationFrame(selectionTrackingTick);
  }

  function selectionTrackingTick() {
    selectionRafId = 0;
    // Inlines shouldTrackSelection()'s checks so getSelectedElements() (a
    // slide-scoped query plus a per-member containment check) runs once
    // per tick instead of twice.
    if (!state.editMode || state.overviewMode || state.editingText) return;
    const members = getSelectedElements();
    if (!members.length) return;
    if (selectionTrackingSnapshotIsStale(selectionTrackingSnapshot, members)) {
      // Something moved (or selection membership changed) since the last
      // snapshot — full refresh, exactly like every other call site.
      // refreshSelection() re-invokes startSelectionTracking() itself,
      // which recaptures the baseline and reschedules the next tick.
      refreshSelection();
      return;
    }
    // Nothing changed — skip the expensive path and just keep watching.
    selectionRafId = requestAnimationFrame(selectionTrackingTick);
  }

  function clearDisconnectedSelection() {
    const current = state.selectedElements && state.selectedElements.length
      ? state.selectedElements
      : (state.selected ? [state.selected] : []);
    if (!state.selected && current.length === 0) return false;

    const members = normalizeSelectionElements(current);
    const primary = (state.selected && members.includes(state.selected))
      ? state.selected
      : (members[members.length - 1] || null);
    const changed = state.selected !== primary || !selectionArraysEqual(state.selectedElements, members);
    if (!changed) return false;

    if (state.editingText && state.editingText.el && !members.includes(state.editingText.el)) {
      state.editingText = null;
    }
    state.selected = primary;
    state.selectedElements = primary ? members : [];
    if (!primary) {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      populateInspector(null);
      refreshInspector();
      stopSelectionTracking();
      return true;
    }
    return false;
  }

  function setSelectedElements(elements, primary) {
    // Close any open txn before swapping selection — defends against
    // an orphaned colour-picker txn (input fired without change) being
    // silently bundled with subsequent unrelated edits on the new
    // selection. endTxn no-ops if no element was touched.
    const members = normalizeSelectionElements(elements);
    const nextPrimary = (primary && members.includes(primary))
      ? primary
      : (members[members.length - 1] || null);
    const selectionChanged = (
      state.selected !== nextPrimary ||
      !selectionArraysEqual(state.selectedElements, members)
    );
    if (selectionChanged && state.txn) endTxn();
    state.selected = nextPrimary;
    state.selectedElements = nextPrimary ? members : [];
    if (state.selected) {
      refreshSelection();
    } else {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      populateInspector(null);
      stopSelectionTracking();
    }
    // Inspector visibility is updated by the explicit call sites below
    // (onClick / onMouseUp / setEditMode / slideObserver) rather than from
    // here. If we toggled inspector display:flex synchronously inside a
    // mousedown handler that swaps from "no selection" to "selected", the
    // newly-shown inspector at top-right would intercept the matching
    // mouseup — the browser then fires `click` on the LCA of mousedown
    // and mouseup targets (== body), and onClick can't find the original
    // target. Updating inspector after the mouseup keeps the click cycle
    // against the original DOM.
  }

  function setSelected(el) {
    setSelectedElements(el ? [el] : [], el || null);
  }

  // The typography rows and their bracketing dividers show/hide as one
  // unit so non-text selections don't render a doubled rule between
  // Size and the colour rows.
  function setTypographyRowsVisible(visible) {
    const d = visible ? '' : 'none';
    typographyDividerTop.style.display = d;
    fontSizeRow.style.display = d;
    weightRow.row.style.display = d;
    alignRow.row.style.display = d;
    typographyDividerBottom.style.display = d;
  }

  function populateInspector(el) {
    if (!el) {
      for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'opacity']) {
        if (document.activeElement !== inspectorInputs[k]) inspectorInputs[k].value = '';
      }
      setTypographyRowsVisible(false);
      textColourRow.row.style.display = 'none';
      populateColours(null);
      populateAnnotation(null);
      return;
    }
    // Use offset* values so what the user reads matches the box model
    // the editor writes back to (left/top/width/height in CSS px).
    // Skip the focused input — overwriting it would clobber what the
    // user is currently typing before they commit on Enter/blur.
    const values = {
      x: String(el.offsetLeft),
      y: String(el.offsetTop),
      w: String(el.offsetWidth),
      h: String(el.offsetHeight),
    };
    for (const k of ['x', 'y', 'w', 'h']) {
      if (document.activeElement === inspectorInputs[k]) continue;
      inspectorInputs[k].value = values[k];
    }
    // Typography (font/weight/align) + text-colour rows render only for
    // text-bearing elements (matching BRIEF "Conditional content by
    // selection type"). Background colour and position/size render for
    // any selection.
    if (isTextBearing(el)) {
      setTypographyRowsVisible(true);
      textColourRow.row.style.display = '';
      populateFontSize(el);
      populateTypography(el);
    } else {
      setTypographyRowsVisible(false);
      textColourRow.row.style.display = 'none';
    }
    populateColours(el);
    populateOpacity(el);
    populateAnnotation(el);
  }

  // ---------------------------------------------------------------------------
  // Colour helpers (v2.4). Parse #rgb / #rrggbb (with or without leading #)
  // into normalized "#rrggbb" strings so apply/populate stay deterministic
  // across browser colour serialisations.
  // ---------------------------------------------------------------------------
  function parseHexInput(raw) {
    if (typeof raw !== 'string') return null;
    let h = raw.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h.split('').map((c) => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return '#' + h.toLowerCase();
  }

  function rgbStringToHex(rgb) {
    if (!rgb || rgb === 'transparent') return null;
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const toHex = (n) => Number(n).toString(16).padStart(2, '0');
    return ('#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3])).toLowerCase();
  }

  function applyColorToElement(el, target, hex) {
    const norm = parseHexInput(hex);
    if (!norm) return false;
    el.style[target === 'text' ? 'color' : 'backgroundColor'] = norm;
    return true;
  }

  function commitColourHex(target, raw, targetEl) {
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el) return;
    if (target === 'text' && !isTextBearing(el)) return;
    const norm = parseHexInput(raw);
    if (!norm) {
      // Garbage input — restore from the live element.
      populateColours(el);
      return;
    }
    if (target === 'text' && state.editingText && state.editingText.el === el) {
      const ctx = startInspectorTxn({ captureHtml: !!getTextColourRange(el) });
      touchElement(el);
      applyTextColourToRange(el, norm);
      endInspectorTxn(ctx);
      populateColours(el);
      return;
    }
    const cssProp = target === 'text' ? 'color' : 'backgroundColor';
    const currentHex = rgbStringToHex(el.style[cssProp] || '');
    if (currentHex === norm) return; // no-op; suppress duplicate history entry
    const ctx = startInspectorTxn();
    touchElement(el);
    el.style[cssProp] = norm;
    endInspectorTxn(ctx);
    populateColours(el);
  }

  function populateColours(el) {
    if (!el) {
      for (const r of [textColourRow, bgColourRow]) {
        if (document.activeElement !== r.hexInput) r.hexInput.value = '';
        r.swatch.style.backgroundColor = '';
        r.swatch.dataset.transparent = 'true';
      }
      return;
    }
    // Text colour
    if (isTextBearing(el)) {
      const textColourSource = getActiveTextColourSpan(el) || el;
      const colorRgb = getComputedStyle(textColourSource).color;
      const hex = rgbStringToHex(colorRgb) || '#000000';
      if (document.activeElement !== textColourRow.hexInput) textColourRow.hexInput.value = hex;
      textColourRow.colorInput.value = hex;
      textColourRow.swatch.style.backgroundColor = hex;
      delete textColourRow.swatch.dataset.transparent;
    }
    // Background colour. computed background-color of "rgba(0,0,0,0)"
    // means transparent — show the checkerboard hint and a sensible
    // default in the picker. If the element has a background-image
    // (e.g. a gradient) the swatch flags that with a stripe pattern,
    // since a single hex can't represent it.
    const bgRgb = getComputedStyle(el).backgroundColor;
    const bgImage = getComputedStyle(el).backgroundImage;
    const hasImage = bgImage && bgImage !== 'none';
    const isTransparent = bgRgb === 'rgba(0, 0, 0, 0)' || bgRgb === 'transparent';
    const bgHex = isTransparent ? '#ffffff' : (rgbStringToHex(bgRgb) || '#ffffff');
    if (document.activeElement !== bgColourRow.hexInput) {
      bgColourRow.hexInput.value = isTransparent ? '' : bgHex;
    }
    bgColourRow.colorInput.value = bgHex;
    bgColourRow.hexInput.placeholder = hasImage ? 'image / gradient' : '';
    if (hasImage) {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.image = 'true';
      delete bgColourRow.swatch.dataset.transparent;
    } else if (isTransparent) {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.transparent = 'true';
      delete bgColourRow.swatch.dataset.image;
    } else {
      bgColourRow.swatch.style.backgroundColor = bgHex;
      delete bgColourRow.swatch.dataset.transparent;
      delete bgColourRow.swatch.dataset.image;
    }
  }

  function populateFontSize(el, { forceInput = false } = {}) {
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize)) || FONT_SIZE_MIN_PX;
    if (forceInput || document.activeElement !== inspectorInputs.fontSize) {
      inspectorInputs.fontSize.value = String(px);
    }
  }

  // Typography seg-state (ink-glass 3b). Computed font-weight normalises
  // to a number string; anything that isn't exactly one of the three
  // offered stops (400/500/700) lights no segment rather than lying
  // about the nearest one. text-align's 'start'/'end' resolve by
  // direction; the editor targets ltr decks so start→left, end→right.
  function normalizeFontWeight(raw) {
    const map = { normal: '400', bold: '700' };
    return map[raw] || String(parseInt(raw, 10) || '');
  }

  function normalizeTextAlign(raw) {
    const map = { start: 'left', end: 'right', '-webkit-auto': 'left' };
    return map[raw] || raw;
  }

  function populateTypography(el) {
    const cs = el ? getComputedStyle(el) : null;
    const weight = cs ? normalizeFontWeight(cs.fontWeight) : '';
    const align = cs ? normalizeTextAlign(cs.textAlign) : '';
    for (const b of weightRow.buttons) {
      b.dataset.active = b.dataset.wfpeValue === weight ? 'true' : 'false';
    }
    for (const b of alignRow.buttons) {
      b.dataset.active = b.dataset.wfpeValue === align ? 'true' : 'false';
    }
  }

  function populateOpacity(el) {
    const raw = parseFloat(getComputedStyle(el).opacity);
    const pct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
    if (document.activeElement !== inspectorInputs.opacity) {
      inspectorInputs.opacity.value = String(pct);
    }
    opacitySlider.value = String(Math.max(0, Math.min(100, pct)));
  }

  function commitInspectorInput(prop, raw, targetEl) {
    // Prefer the target captured at focus-time so a mid-edit selection
    // change doesn't redirect the commit to the new element.
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el) return;
    const next = parseFloat(raw);
    if (!Number.isFinite(next)) {
      // Garbage input — restore the readout from the live element.
      populateInspector(el);
      return;
    }
    if (prop === 'fontSize') {
      if (!isTextBearing(el)) return;
      const current = parseFloat(getComputedStyle(el).fontSize);
      const clamped = Math.max(FONT_SIZE_MIN_PX, next);
      if (Math.round(clamped) === Math.round(current)) return;
      const ctx = startInspectorTxn();
      touchElement(el);
      el.style.fontSize = `${clamped}px`;
      endInspectorTxn(ctx);
      refreshSelection();
      return;
    }
    if (prop === 'opacity') {
      const pct = Math.max(0, Math.min(100, next));
      // `|| 1` would treat a legitimate 0 as falsy and default to 100,
      // breaking the no-op guard after a clamp-to-zero. Use isFinite.
      const raw = parseFloat(getComputedStyle(el).opacity);
      const currentPct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
      if (Math.round(pct) === currentPct) return;
      const ctx = startInspectorTxn();
      touchElement(el);
      el.style.opacity = String(pct / 100);
      endInspectorTxn(ctx);
      refreshSelection();
      return;
    }
    // Compare against the live offset; abort no-op commits so blur
    // cycling doesn't pollute history.
    const offsetMap = { x: 'offsetLeft', y: 'offsetTop', w: 'offsetWidth', h: 'offsetHeight' };
    const current = el[offsetMap[prop]];
    if (Math.round(next) === current) return;

    const ctx = startInspectorTxn();
    touchElement(el);
    // X/Y require absolute positioning; unlock-on-flow if needed (same
    // path drag/resize use, which also pins flex/grid siblings so the
    // sudden absolute promotion doesn't reflow the layout).
    if (prop === 'x' || prop === 'y') {
      if (getComputedStyle(el).position !== 'absolute') unlockToAbsolute(el);
    }
    const cssProp = { x: 'left', y: 'top', w: 'width', h: 'height' }[prop];
    // Clamp width/height to the same minimum the resize handle enforces
    // so inspector edits can't shrink an element below the resize floor.
    const clamped = (prop === 'w' || prop === 'h') ? Math.max(RESIZE_MIN_PX, next) : next;
    if (prop === 'w') applyExplicitSizeConstraints(el, { width: clamped });
    if (prop === 'h') applyExplicitSizeConstraints(el, { height: clamped });
    el.style[cssProp] = `${clamped}px`;
    endInspectorTxn(ctx);
    refreshSelection();
  }

  // ===========================================================================
  // Inspector visibility + minimise/expand
  //
  // The inspector appears whenever an element is selected and hides on
  // deselect or slide change. Minimised/expanded preference persists
  // across selections within the session via state.inspectorMinimised;
  // reload resets to expanded (in-memory only — localStorage persistence
  // is a v2.x ROADMAP item).
  // ===========================================================================
  function refreshInspector() {
    const visible = getSelectedElements().length === 1 && !!state.selected;
    // Ink-glass 3b/5b: selection drives the dock fold, then the shared
    // seam refresh reconciles the toolbar corner morph, the menu's
    // bottom radius, and inspector suppression in one place — the three
    // must never disagree, or a seam breaks (squared bar over no panel,
    // or panel under a capsule).
    inspectorDock.dataset.visible = visible ? 'true' : 'false';
    refreshStackSeams();
    // Legacy mirror — no CSS keys off this any more, but it's a stable
    // hook existing tests/tooling query.
    inspector.dataset.visible = visible ? 'true' : 'false';
    inspector.dataset.state = state.inspectorMinimised ? 'minimised' : 'expanded';
    // The minimise chevron is a single icon rotated by CSS; only the
    // accessible naming changes with state.
    inspectorMinimiseBtn.title = state.inspectorMinimised ? 'Expand' : 'Minimise';
    inspectorMinimiseBtn.setAttribute(
      'aria-label',
      state.inspectorMinimised ? 'Expand inspector' : 'Minimise inspector'
    );
    positionInspectorStack();
    refreshExportUi();
  }

  function setInspectorMinimised(value) {
    state.inspectorMinimised = !!value;
    refreshInspector();
  }

  // Keep the complete editor instrument clear of the selected element at
  // rest. The current side wins while it remains clear; switching happens
  // only when that side overlaps and the opposite side does not. This
  // hysteresis prevents placement oscillation as layout settles.
  function positionInspectorStack() {
    const visible = inspectorDock.dataset.visible === 'true';
    if (!visible || state.overviewMode || getSelectedElements().length !== 1) {
      inspector.dataset.avoidance = 'clear';
      inspector.dataset.revealed = 'false';
      return;
    }
    // A live manipulation intentionally holds the dock still so v2.12's
    // overlap-gated fade remains meaningful as content passes beneath it.
    if (state.drag || state.resize || state.txn || state.editingText) return;

    const selectionRect = getLiveSelectionRect();
    if (!selectionRect) return;
    const margin = 16;
    const gutter = 10;
    const width = Math.max(246, stack.offsetWidth || 0);
    const toolbarHeight = toolbar.offsetHeight || 36;
    const exportHeight = state.exportMenuOpen ? (exportMenu.offsetHeight + 1) : 0;
    const bodyHeight = (state.inspectorMinimised || state.exportMenuOpen)
      ? 0
      : inspectorFoldInner.scrollHeight;
    const inspectorHeight = (inspectorHeader.offsetHeight || 36) + bodyHeight + 1;
    const height = Math.min(
      toolbarHeight + exportHeight + inspectorHeight + 2,
      window.innerHeight - margin * 2
    );
    const expandedSelection = {
      left: selectionRect.left - gutter,
      top: selectionRect.top - gutter,
      right: selectionRect.right + gutter,
      bottom: selectionRect.bottom + gutter,
    };
    const candidates = {
      left: { left: margin, top: margin, right: margin + width, bottom: margin + height },
      right: {
        left: window.innerWidth - margin - width,
        top: margin,
        right: window.innerWidth - margin,
        bottom: margin + height,
      },
    };
    const current = stack.dataset.side === 'left' ? 'left' : 'right';
    const other = current === 'right' ? 'left' : 'right';
    const currentBlocked = rectsOverlap(expandedSelection, candidates[current]);
    const otherBlocked = rectsOverlap(expandedSelection, candidates[other]);
    if (currentBlocked && !otherBlocked) stack.dataset.side = other;
    const nextAvoidance = currentBlocked && otherBlocked ? 'overlap' : 'clear';
    if (inspector.dataset.avoidance !== nextAvoidance || nextAvoidance === 'clear') {
      inspector.dataset.revealed = 'false';
    }
    inspector.dataset.avoidance = nextAvoidance;
  }
