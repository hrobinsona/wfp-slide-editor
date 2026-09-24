  // Rectangle selection operates entirely in viewport coordinates. Existing
  // group movement performs its own conversion to the deck's coordinate space.
  function startMarquee(e, target) {
    const slide = getActiveSlide();
    if (!slide || (target && !e.shiftKey) || state.markdownMode || state.overviewMode) return false;
    const bounds = slide.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) return false;
    const box = document.createElement('div');
    box.className = 'wfpe-marquee';
    box.style.cssText = 'position:fixed;pointer-events:none;border:1px solid #f0685b;background:rgba(240,104,91,.12);z-index:12;display:none;box-sizing:border-box';
    root.appendChild(box);
    const noteDraft = annotationRow.dataset.dirty === 'true'
      ? { target:annotationRow.__wfpeTarget, text:annotationTextarea.value } : null;
    state.marquee = { slide, box, x:e.clientX, y:e.clientY, before:getSelectedElements(), primary:state.selected, noteDraft, additive:e.metaKey || e.ctrlKey, started:false };
    e.preventDefault();
    e.stopPropagation();
    document.addEventListener('mousemove', moveMarquee, true);
    document.addEventListener('mouseup', endMarquee, true);
    document.addEventListener('pointercancel', cancelMarquee, true);
    window.addEventListener('blur', cancelMarquee);
    window.addEventListener('resize', cancelMarquee);
    window.addEventListener('scroll', scrollMarquee, true);
    return true;
  }

  function moveMarquee(e) {
    const gesture = state.marquee;
    if (!gesture) return;
    if (!e.buttons || gesture.slide !== getActiveSlide() || !state.editMode || state.overviewMode) { finishMarquee(true); return; }
    if (!gesture.started && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 4) return;
    gesture.started = true;
    const rect = { left:Math.min(e.clientX, gesture.x), top:Math.min(e.clientY, gesture.y), right:Math.max(e.clientX, gesture.x), bottom:Math.max(e.clientY, gesture.y) };
    Object.assign(gesture.box.style, { display:'block', left:rect.left+'px', top:rect.top+'px', width:(rect.right-rect.left)+'px', height:(rect.bottom-rect.top)+'px' });
    const candidates = [...new Set([...gesture.slide.querySelectorAll('*')].map(findSelectableTarget).filter(Boolean))].filter(el => {
      if (el.matches('script,style,link,meta') || el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return false;
      for (let ancestor = el; ancestor && gesture.slide.contains(ancestor); ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (Number(ancestorStyle.opacity) === 0 || ancestorStyle.visibility === 'hidden' || ancestorStyle.display === 'none') return false;
      }
      const style = getComputedStyle(el);
      const bounds = el.getBoundingClientRect();
      return isMarqueeVisibleObject(el, style) && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0 &&
        bounds.width > 0 && bounds.height > 0 && bounds.left >= rect.left && bounds.right <= rect.right && bounds.top >= rect.top && bounds.bottom <= rect.bottom;
    });
    // Prefer an enclosed visible box to its children, but skip transparent
    // layout wrappers so a row of cards selects the cards, not their flex row.
    const enclosed = candidates.filter(el => !candidates.some(parent => parent !== el && parent.contains(el)));
    const members = gesture.additive ? [...gesture.before] : [];
    for (const el of enclosed) {
      for (let i = members.length - 1; i >= 0; i--) {
        if (el.contains(members[i]) || members[i].contains(el)) members.splice(i, 1);
      }
      members.push(el);
    }
    setSelectedElements(members);
    e.preventDefault();
    e.stopPropagation();
  }

  function isMarqueeVisibleObject(el, style) {
    if (isTextBearing(el) || el.matches('img,svg,canvas,video,audio,iframe,input,textarea,select,hr')) return true;
    // Text whose entire contents use inline formatting is still a visible run.
    if (el.textContent.trim() && [...el.children].every(child => getComputedStyle(child).display === 'inline')) return true;
    const paintedColour = colour => colour !== 'transparent' &&
      !/^(?:rgba|hsla)\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(colour) &&
      !/\/\s*0(?:\.0+)?%?\s*\)$/.test(colour);
    if (paintedColour(style.backgroundColor) || style.backgroundImage !== 'none' || style.boxShadow !== 'none') return true;
    return ['Top','Right','Bottom','Left'].some(side =>
      parseFloat(style['border'+side+'Width']) > 0 && !['none','hidden'].includes(style['border'+side+'Style']) && paintedColour(style['border'+side+'Color']));
  }

  function endMarquee() { finishMarquee(false); }
  function scrollMarquee(event) { if (!root.contains(event.target)) cancelMarquee(); }
  function cancelMarquee() { finishMarquee(true); }
  function finishMarquee(cancelled) {
    const gesture = state.marquee;
    if (!gesture) return;
    state.marquee = null;
    document.removeEventListener('mousemove', moveMarquee, true);
    document.removeEventListener('mouseup', endMarquee, true);
    document.removeEventListener('pointercancel', cancelMarquee, true);
    window.removeEventListener('blur', cancelMarquee);
    window.removeEventListener('resize', cancelMarquee);
    window.removeEventListener('scroll', scrollMarquee, true);
    gesture.box.remove();
    if (cancelled) setSelectedElements(gesture.before, gesture.primary);
    if (gesture.started || cancelled) state.suppressClickUntil = Date.now() + POST_DRAG_CLICK_GUARD_MS;
    refreshInspector();
    if (cancelled && gesture.noteDraft && gesture.noteDraft.target === state.selected && getSelectedElements().length === 1) {
      annotationTextarea.value = gesture.noteDraft.text;
      updateAnnotationDraftStatus(state.selected);
      autoGrowAnnotationTextarea();
      positionInspectorStack();
    }
  }
