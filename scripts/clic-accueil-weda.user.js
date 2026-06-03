// ==UserScript==
// @name         Weda - clic accueil automatique
// @namespace    local.weda
// @version      1.0.2
// @description  Clique automatiquement sur le bouton d'accueil Weda apres 20 minutes sans activite.
// @match        https://secure.weda.fr/*
// @match        https://*.weda.fr/*
// @match        http://*.weda.fr/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const IDLE_DELAY_MS = 20 * 60 * 1000;
  const NOISY_EVENT_THROTTLE_MS = 1000;

  const ACTIVITY_EVENTS = [
    'click',
    'change',
    'input',
    'keydown',
    'mousedown',
    'mousemove',
    'pointerdown',
    'scroll',
    'touchstart',
    'wheel',
  ];

  const HOME_SELECTORS = [
    "#ContentPlaceHolder1_DivMenuNavigate a.level1.static[onclick*=\"MenuNavigate\"][onclick*=\"'0'\"]",
    '#ContentPlaceHolder1_DivMenuNavigate a.level1.static',
    '#ContentPlaceHolder1_MenuNavigate > ul.level1 > li > a.level1.static',
    '#ContentPlaceHolder1_DivMenuNavigate a[onclick*="MenuNavigate"]',
    '#btnAccueil',
    '#BtnAccueil',
    '#accueil',
    '#Accueil',
    '#home',
    '#Home',
    '[data-testid*="accueil" i]',
    '[data-test*="accueil" i]',
    '[id*="accueil" i]',
    '[class*="accueil" i]',
    '[title*="accueil" i]',
    '[aria-label*="accueil" i]',
    'a[href*="accueil" i]',
    'button[name*="accueil" i]',
    'input[value*="accueil" i]',
    'img[alt*="accueil" i]',
  ];

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isClickable(element) {
    if (!element || !isVisible(element)) {
      return false;
    }

    if ('disabled' in element && element.disabled) {
      return false;
    }

    return true;
  }

  function getClickableElement(element) {
    return element.closest('a, button, input, [role="button"], [onclick]') || element;
  }

  function findHomeButton() {
    for (const selector of HOME_SELECTORS) {
      const elements = document.querySelectorAll(selector);

      for (const element of elements) {
        const clickableElement = getClickableElement(element);

        if (isClickable(clickableElement)) {
          return clickableElement;
        }
      }
    }

    const textCandidates = document.querySelectorAll('a, button, [role="button"], [onclick]');

    for (const element of textCandidates) {
      const label = `${element.textContent || ''} ${element.title || ''} ${element.getAttribute('aria-label') || ''}`;

      if (/\baccueil\b/i.test(label) && isClickable(element)) {
        return element;
      }
    }

    return null;
  }

  let lastUserActivityAt = Date.now();
  let nextIdleClickAt = lastUserActivityAt + IDLE_DELAY_MS;
  let idleTimerId = null;
  let lastNoisyActivityAt = 0;

  function clickHomeButton() {
    const homeButton = findHomeButton();

    if (!homeButton) {
      console.warn('[Weda accueil auto] Bouton d accueil introuvable.');
      return false;
    }

    homeButton.click();
    console.info('[Weda accueil auto] Clic sur le bouton d accueil effectue.', new Date().toLocaleString());
    return true;
  }

  function scheduleIdleCheck() {
    window.clearTimeout(idleTimerId);
    idleTimerId = window.setTimeout(checkIdleTime, Math.max(nextIdleClickAt - Date.now(), 1000));
  }

  function noteUserActivity(event) {
    if (event && event.isTrusted === false) {
      return;
    }

    const now = Date.now();

    if (event && ['mousemove', 'scroll', 'wheel'].includes(event.type)) {
      if (now - lastNoisyActivityAt < NOISY_EVENT_THROTTLE_MS) {
        return;
      }

      lastNoisyActivityAt = now;
    }

    lastUserActivityAt = now;
    nextIdleClickAt = now + IDLE_DELAY_MS;
    scheduleIdleCheck();
  }

  function checkIdleTime() {
    const now = Date.now();
    const idleMs = now - lastUserActivityAt;

    if (idleMs >= IDLE_DELAY_MS && now >= nextIdleClickAt) {
      clickHomeButton();
      nextIdleClickAt = now + IDLE_DELAY_MS;
    }

    scheduleIdleCheck();
  }

  for (const eventName of ACTIVITY_EVENTS) {
    window.addEventListener(eventName, noteUserActivity, { capture: true, passive: true });
  }

  scheduleIdleCheck();
  console.info('[Weda accueil auto] Script actif : clic accueil apres 20 minutes sans activite.');
})();
