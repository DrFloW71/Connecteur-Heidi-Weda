// ==UserScript==
// @name         AmeliPro - clic accueil automatique
// @namespace    local.amelipro
// @version      1.0.0
// @description  Clique automatiquement sur le bouton d'accueil AmeliPro apres 15 minutes sans activite.
// @match        https://espacepro.ameli.fr/page-accueil-ihm
// @match        https://espacepro.ameli.fr/page-accueil-ihm/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const IDLE_DELAY_MS = 15 * 60 * 1000;
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
    '#page-accueil-header-brand-section-logo-link',
    '#page-accueil-header-brand-section-container a[href]',
    '#page-accueil-header-brand-section-container',
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
    if (!element) {
      return null;
    }

    if (element.matches('a, button, input, [role="button"], [onclick]')) {
      return element;
    }

    return (
      element.querySelector('a, button, input, [role="button"], [onclick]') ||
      element.closest('a, button, input, [role="button"], [onclick]') ||
      element
    );
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

    return null;
  }

  let lastUserActivityAt = Date.now();
  let nextIdleClickAt = lastUserActivityAt + IDLE_DELAY_MS;
  let idleTimerId = null;
  let lastNoisyActivityAt = 0;

  function clickHomeButton() {
    const homeButton = findHomeButton();

    if (!homeButton) {
      console.warn('[AmeliPro accueil auto] Bouton d accueil introuvable.');
      return false;
    }

    homeButton.click();
    console.info('[AmeliPro accueil auto] Clic sur le bouton d accueil effectue.', new Date().toLocaleString());
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
  console.info('[AmeliPro accueil auto] Script actif : clic accueil apres 15 minutes sans activite.');
})();
