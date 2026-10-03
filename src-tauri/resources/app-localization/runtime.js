/*
 * Antigravity Tools Lite: reversible, allowlisted App UI localization.
 *
 * This file is a JavaScript expression yielding a factory. The caller invokes
 * it with (window, JSON data). Dictionaries are data, never executable scripts.
 * No adapter may be supplied by config. Add a production adapter only after
 * verifying its exact release, static-label ownership and DOM paths against an
 * official App build. A dictionary match alone is never permission to translate.
 *
 * The 2.19.1 Settings button and eight Settings navigation labels are
 * live-verified. Other source-known navigation labels are validated for drift
 * but never translated. They require separate real-App verification.
 */
(function createAppLocalization(host, config) {
  'use strict';

  const REGISTRY_KEY = '__ANTIGRAVITY_TOOLS_LOCALIZATION__';
  const BRAND = 'antigravity-tools-scoped-localization-v1';
  const NAV_ROOT_CLASS = 'h-full w-full flex flex-col bg-sidebar';
  const SCROLL_CLASS = 'flex-1 flex flex-col gap-1 py-3 overflow-y-auto';
  const HEADER_CLASS = 'm-0 text-xs font-medium text-muted-foreground select-none';
  const GROUP_CLASS = 'flex flex-col gap-0.5';
  const BUTTON_CLASS = 'flex items-center gap-1.5 group mx-2 px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none';
  const LABEL_CLASS = 'text-sm transition-colors select-none truncate flex-1';
  const KNOWN_NAV_LABELS = Object.freeze({
    General: 'General', App: 'Application', Appearance: 'Appearance', Skin: 'Skin',
    Notifications: 'Notifications', Models: 'Models', Customizations: 'Customizations',
    Developer: 'Developer', Tab: 'Tab', Editor: 'Editor',
  });
  // Actual macOS 2.19.1 acceptance covered only this global-navigation subset.
  // The heading and fixed tail below complete the eight verified nav labels.
  const VERIFIED_NAV_KEYS = new Set(['General', 'App', 'Appearance', 'Models', 'Customizations']);
  const INTERNAL_SCREENS = new Set(['Jetski Chat', 'Regroup Google3 Chats']);
  const TAIL_LABELS = ['Shortcuts', 'Provide Feedback'];
  const VERIFIED_NAV_SOURCES = Object.freeze([
    'Settings', ...[...VERIFIED_NAV_KEYS].map((key) => KNOWN_NAV_LABELS[key]), ...TAIL_LABELS,
  ]);
  const SETTINGS_BUTTON_SCOPE = {
    id: 'settings-button', optional: true, verification: 'live-verified',
    root: { testId: 'settings-button', tagName: 'BUTTON' },
    fields: [{ id: 'label', path: [{ tagName: 'SPAN', attributes: { class: 'truncate text-sm' } }], kind: 'text', source: 'Settings' }],
  };
  const NAVIGATION_SCOPE = {
    id: 'settings-navigation', optional: true, kind: 'settings-navigation',
    verification: 'live-verified',
    root: { tagName: 'DIV', attributes: { class: NAV_ROOT_CLASS } },
  };
  const VERIFIED_ADAPTERS = Object.freeze([{
    id: 'antigravity-2.19.1-limited-ui', appVersion: '2.19.1',
    scopes: [SETTINGS_BUTTON_SCOPE, NAVIGATION_SCOPE],
  }]); // PRODUCTION_ADAPTERS_END
  const LEASE_MS = 15000; // Tools must explicitly renew every 3000 ms.
  const TEXT = 'text';
  const ATTRIBUTE_KINDS = new Set(['title', 'aria-label', 'aria-description']);
  const FORBIDDEN_TAGS = new Set([
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OUTPUT', 'CODE', 'PRE', 'SCRIPT',
    'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS',
    'SVG', 'MATH', 'VIDEO', 'AUDIO', 'SAMP', 'KBD', 'VAR',
  ]);
  const FORBIDDEN_CLASSES = new Set([
    'monaco-editor', 'view-lines', 'view-line', 'xterm', 'terminal', 'code-block',
    'editor-instance', 'hljs', 'token', 'markdown', 'markdown-body',
    'chat-message', 'message-content', 'user-content', 'file-path',
  ]);
  const FORBIDDEN_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'log']);
  const FORBIDDEN_ATTRIBUTES = [
    'contenteditable', 'data-user-content', 'data-message-id', 'data-chat-message',
    'data-file-path', 'data-code',
  ];
  const OBSERVED_ATTRIBUTES = [
    'data-testid', 'class', 'role', 'translate', ...FORBIDDEN_ATTRIBUTES,
    ...ATTRIBUTE_KINDS,
  ];
  const doc = host && host.document;
  let adapter = null;
  let configError = null;
  let observer = null;
  let pendingTimer = null;
  let leaseTimer = null;
  let disposedReason = null;
  let active = false;
  let disposed = false;
  let api;
  let observedScopes = [];
  let scopeStatuses = [];
  let dependencies = new Set();
  const owned = new Map();
  const exact = Object.create(null);
  let appVersion = null;
  let lastFailure = null;

  function ownData(object, key) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
    const property = Object.getOwnPropertyDescriptor(object, key);
    return property && Object.prototype.hasOwnProperty.call(property, 'value')
      ? property.value : undefined;
  }

  const contentOwned = new Map();
  let contentContainer = null;

  function status(code, reason, extra) {
    const totalTranslated = owned.size + contentOwned.size;
    return Object.assign({
      status: code,
      supported: code === 'supported' || code === 'applied',
      active,
      appVersion,
      adapterId: adapter ? adapter.id : null,
      translated: totalTranslated,
      reason: reason || null,
      scopes: scopeStatuses.map((scope) => ({ ...scope })),
      awaitingScope: active && totalTranslated === 0,
    }, extra || {});
  }

  // Read only ordinary own data properties; config accessors cannot run here.
  appVersion = ownData(config, 'appVersion');
  if (typeof appVersion !== 'string' || !appVersion || appVersion.length > 100 ||
      ownData(config, 'locale') !== 'zh-CN') {
    appVersion = typeof appVersion === 'string' ? appVersion : null;
    configError = 'Expected an exact appVersion and locale zh-CN';
  } else {
    adapter = VERIFIED_ADAPTERS.find((item) => item.appVersion === appVersion) || null;
  }

  const scopes = adapter ? adapter.scopes || [{ id: 'legacy', root: adapter.root, fields: adapter.fields }] : [];
  if (adapter) {
    const dictionary = ownData(config, 'dictionary');
    const inputExact = ownData(dictionary, 'exact');
    const sources = new Set(scopes.flatMap((scope) => scope.kind === 'settings-navigation'
      ? VERIFIED_NAV_SOURCES
      : scope.fields.map((field) => field.source)));
    for (const source of sources) {
      const value = ownData(inputExact, source);
      if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
        configError = 'Missing or invalid allowlisted exact dictionary entry';
        break;
      }
      exact[source] = value;
    }
    if (inputExact && typeof inputExact === 'object' && !configError) {
      for (const key of Object.keys(inputExact)) {
        const val = ownData(inputExact, key);
        if (typeof val === 'string' && val.length > 0 && val.length <= 2000 && !exact[key]) {
          exact[key] = val;
        }
      }
    }
  }

  function safeElement(element) {
    if (!element || element.nodeType !== 1) return false;
    // No depth limit: a deeply nested editor/chat descendant stays excluded.
    for (let current = element; current; current = current.parentElement) {
      if (FORBIDDEN_TAGS.has(current.tagName) || current.isContentEditable ||
          FORBIDDEN_ROLES.has(current.getAttribute('role')) ||
          current.getAttribute('translate') === 'no' ||
          FORBIDDEN_ATTRIBUTES.some((name) => current.hasAttribute(name))) return false;
      if (current.classList && [...current.classList].some((name) => FORBIDDEN_CLASSES.has(name))) {
        return false;
      }
    }
    return element.isConnected === true;
  }

  function matches(element, anchor) {
    if (!element || element.nodeType !== 1 || element.tagName !== anchor.tagName) return false;
    if (anchor.testId) {
      if (element.getAttribute('data-testid') !== anchor.testId) return false;
    } else if (!anchor.attributes || typeof anchor.attributes.class !== 'string' || !anchor.attributes.class) {
      // Some official static label children have no test id. Only a literal,
      // source-reviewed class signature is allowed inside the exact root.
      return false;
    }
    return Object.entries(anchor.attributes || {}).every(([name, value]) =>
      element.getAttribute(name) === value);
  }

  function rootSelector(scope) {
    // These selectors are code-owned literals, never config or dictionary data.
    return scope.root.testId ? '[data-testid="' + scope.root.testId + '"]'
      : scope.root.tagName.toLowerCase() + '[class="' + scope.root.attributes.class + '"]';
  }

  function classAnchor(tagName, value, index) {
    return { tagName, attributes: { class: value }, ...(index === undefined ? {} : { index }) };
  }

  function navButtonField(button, prefix, path, index) {
    const testId = button.getAttribute('data-testid');
    const key = testId && testId.slice('settings-nav-item-'.length);
    if (!testId || testId !== 'settings-nav-item-' + key) return null;
    const activeClass = BUTTON_CLASS + ' bg-sidebar-secondary';
    const inactiveClass = BUTTON_CLASS + ' hover:bg-sidebar-muted';
    const buttonClass = button.getAttribute('class');
    if (button.tagName !== 'BUTTON' || button.getAttribute('type') !== 'button' ||
        ![activeClass, inactiveClass].includes(buttonClass) || button.children.length !== 1) return null;
    const labelClass = LABEL_CLASS + (buttonClass === activeClass
      ? ' text-foreground' : ' text-secondary-foreground group-hover:text-foreground');
    const source = prefix === 'global' ? ownData(KNOWN_NAV_LABELS, key) : TAIL_LABELS.includes(key) ? key : null;
    if (!source && !(prefix === 'global' && INTERNAL_SCREENS.has(key))) return null;
    const label = button.children[0];
    if (!matches(label, classAnchor('SPAN', labelClass)) || label.childNodes.length !== 1 ||
        label.firstChild.nodeType !== 3 || !safeElement(label)) return null;
    return {
      id: prefix + ':' + key, source: source || key,
      skip: !source || (prefix === 'global' && !VERIFIED_NAV_KEYS.has(key)), kind: TEXT,
      path: [...path, { tagName: 'BUTTON', testId, index,
        attributes: { type: 'button', class: buttonClass } }, classAnchor('SPAN', labelClass, 0)],
    };
  }

  function fieldsForScope(scope, root) {
    if (scope.kind !== 'settings-navigation') return scope.fields;
    const scrollPath = [classAnchor('DIV', SCROLL_CLASS, 0)];
    const scroll = root.children[0];
    if (!matches(scroll, scrollPath[0])) return null;
    const header = scroll.children[0];
    const group = scroll.children[1];
    if (!matches(header, classAnchor('DIV', 'px-4')) || header.children.length !== 1 ||
        !matches(header.children[0], classAnchor('H1', HEADER_CLASS)) ||
        !matches(group, classAnchor('DIV', GROUP_CLASS))) return null;
    const fields = [{ id: 'heading', kind: TEXT, source: 'Settings',
      path: [...scrollPath, classAnchor('DIV', 'px-4', 0), classAnchor('H1', HEADER_CLASS, 0)] }];
    const ids = new Set();
    for (const [index, button] of [...group.children].entries()) {
      const field = navButtonField(button, 'global', [...scrollPath, classAnchor('DIV', GROUP_CLASS, 1)], index);
      if (!field || ids.has(field.id)) return null;
      ids.add(field.id);
      fields.push(field);
    }
    // The reusable T4 test id also labels user projects/workspaces. Only the
    // first, header-adjacent group above is owned global navigation. No other
    // group is traversed. Fixed footer controls are direct children after the
    // source-literal flex-1 spacer, never descendants of workspace/project groups.
    const spacers = [...scroll.children].filter((child) => matches(child, classAnchor('DIV', 'flex-1')));
    if (spacers.length !== 1) return null;
    const spacerIndex = [...scroll.children].indexOf(spacers[0]);
    if (spacerIndex < 2) return null;
    let lastOrder = -1;
    for (let index = spacerIndex + 1; index < scroll.children.length; index += 1) {
      const field = navButtonField(scroll.children[index], 'tail', scrollPath, index);
      const order = field ? TAIL_LABELS.indexOf(field.source) : -1;
      if (!field || order <= lastOrder) return null;
      lastOrder = order;
      fields.push(field);
    }
    return fields;
  }

  function resolve(root, field, dependents) {
    let current = root;
    for (const anchor of field.path) {
      // Paths are direct child chains, not unconstrained descendant queries.
      const found = [...current.children].filter((child, index) =>
        (anchor.index === undefined || anchor.index === index) && matches(child, anchor));
      if (found.length !== 1) return null;
      current = found[0];
      if (dependents) dependents.add(current);
    }
    if (!safeElement(current)) return null;
    if (field.kind === TEXT) {
      if (current.childNodes.length !== 1 || current.firstChild.nodeType !== 3) return null;
      if (dependents) dependents.add(current.firstChild);
      return { element: current, node: current.firstChild, field };
    }
    if (!ATTRIBUTE_KINDS.has(field.kind) || !current.hasAttribute(field.kind)) return null;
    return { element: current, node: current, field };
  }

  function readValue(target) {
    return target.field.kind === TEXT ? target.node.data : target.element.getAttribute(target.field.kind);
  }

  function writeValue(target, value) {
    if (target.field.kind === TEXT) target.node.data = value;
    else target.element.setAttribute(target.field.kind, value);
  }

  function affected(record, mutation) {
    return (mutation.type === 'characterData' && mutation.target === record.node) ||
      (mutation.type === 'attributes' && mutation.target === record.element &&
        mutation.attributeName === record.field.kind) ||
      (mutation.type === 'childList' && mutation.target === record.element && record.field.kind === TEXT);
  }

  function releaseExternalWrites(mutations) {
    // Our writes occur with the observer disconnected. Any queued write to an
    // owned value is external, including an external write of the SAME value.
    for (const [index, record] of owned) {
      if (mutations.some((mutation) => affected(record, mutation))) owned.delete(index);
    }
    for (const [node, record] of contentOwned) {
      if (mutations.some((mutation) => mutation.type === 'characterData' && mutation.target === node && node.data !== record.translated)) {
        contentOwned.delete(node);
      }
    }
  }

  function drainExternalWrites() {
    if (observer) releaseExternalWrites(observer.takeRecords());
  }

  function findContentContainer() {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    const modal = doc.querySelector('.settings-modal-container');
    if (modal) {
      const panel = modal.querySelector('div[class="flex h-full overflow-auto"]');
      if (panel) return panel;
    }
    return null;
  }

  function translateContent() {
    const container = findContentContainer();
    contentContainer = container;
    if (!container) {
      if (contentOwned.size > 0) contentOwned.clear();
      return 0;
    }
    const walker = doc.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
    let node;
    let count = 0;
    while ((node = walker.nextNode())) {
      if (!safeElement(node.parentElement)) continue;
      const record = contentOwned.get(node);
      if (record) {
        if (node.data === record.translated) {
          count += 1;
          continue;
        }
        contentOwned.delete(node);
      }
      const raw = node.data;
      if (!raw) continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const targetVal = exact[trimmed];
      if (typeof targetVal === 'string' && targetVal.length > 0 && targetVal !== trimmed) {
        const translated = raw.replace(trimmed, targetVal);
        contentOwned.set(node, { original: raw, translated });
        node.data = translated;
        count += 1;
      }
    }
    for (const [n] of contentOwned) {
      if (!n.isConnected) contentOwned.delete(n);
    }
    return count;
  }

  function restoreContent() {
    let restored = 0;
    for (const [node, record] of contentOwned) {
      if (node.isConnected && node.data === record.translated) {
        try {
          node.data = record.original;
          restored += 1;
        } catch (_) {}
      }
    }
    contentOwned.clear();
    contentContainer = null;
    return restored;
  }

  function inspect() {
    if (disposed) return { error: status('disposed', 'Controller has been disposed') };
    if (configError) return { error: status('invalid_config', configError) };
    if (!adapter) return { error: status('unsupported_version', 'No verified adapter for this exact App version') };
    if (!doc || typeof doc.querySelectorAll !== 'function' ||
        typeof host.MutationObserver !== 'function' ||
        typeof host.setTimeout !== 'function' || typeof host.clearTimeout !== 'function') {
      return { error: status('runtime_error', 'Required DOM lifecycle APIs are unavailable') };
    }
    const nextDependencies = new Set();
    const targets = [];
    const nextScopes = [];
    const nextStatuses = [];
    const uniqueProperties = new Map();
    for (const scope of scopes) {
      const roots = doc.querySelectorAll(rootSelector(scope));
      if (roots.length === 0 && scope.optional) {
        // Route removal detaches the old root. A still-connected root losing
        // its verified identity is DOM drift, not an absent optional scope.
        if (observedScopes.some((entry) => entry.scope.id === scope.id && entry.root.isConnected)) {
          return { error: status('unsupported_dom', 'Scope ' + scope.id + ': connected root identity drift') };
        }
        nextStatuses.push({ id: scope.id, present: false, labelCount: 0, verification: scope.verification || 'offline-fixture' });
        continue;
      }
      if (roots.length !== 1 || !matches(roots[0], scope.root) || !safeElement(roots[0])) {
        return { error: status('unsupported_dom', 'Scope ' + scope.id + ': root is missing, ambiguous, or excluded') };
      }
      const root = roots[0];
      const prior = observedScopes.find((entry) => entry.scope.id === scope.id);
      if (prior && prior.root.isConnected && (prior.root !== root || prior.rootParent !== root.parentNode)) {
        return { error: status('unsupported_dom', 'Scope ' + scope.id + ': connected root moved or changed identity') };
      }
      for (let current = root; current; current = current.parentElement) nextDependencies.add(current);
      const fields = fieldsForScope(scope, root);
      if (!fields) return { error: status('unsupported_dom', 'Scope ' + scope.id + ': static structure drift') };
      let labelCount = 0;
      for (const [index, field] of fields.entries()) {
        const target = resolve(root, field, nextDependencies);
        if (!target) return { error: status('unsupported_dom', 'Scope ' + scope.id + ': static label path is missing or excluded') };
        const properties = uniqueProperties.get(target.node) || new Set();
        if (properties.has(field.kind)) return { error: status('unsupported_dom', 'Adapter contains overlapping fields') };
        properties.add(field.kind);
        uniqueProperties.set(target.node, properties);
        const key = scope.id + '/' + (field.id || index);
        const value = readValue(target);
        const record = owned.get(key);
        const isOurs = record && record.root === root && record.element === target.element &&
          record.node === target.node && value === record.translated;
        if (value !== field.source && !isOurs) {
          return { error: status('unsupported_dom', 'Scope ' + scope.id + ': static label drift') };
        }
        if (!field.skip) {
          targets.push({ ...target, key, scope, root, rootParent: root.parentNode });
          labelCount += 1;
        }
      }
      nextScopes.push({ scope, root, rootParent: root.parentNode });
      nextStatuses.push({ id: scope.id, present: true, labelCount, verification: scope.verification || 'offline-fixture' });
    }
    return { scopes: nextScopes, targets, dependencies: nextDependencies, scopeStatuses: nextStatuses };
  }

  function clearTimer() {
    if (pendingTimer !== null) host.clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function stopObserving() {
    clearTimer();
    if (leaseTimer !== null) host.clearTimeout(leaseTimer);
    leaseTimer = null;
    if (observer) observer.disconnect();
    active = false;
  }

  function restoreOwned() {
    let restored = 0;
    let preserved = 0;
    // Ownership is tied to each original root object and its parent. A new
    // duplicate must not prevent rollback of the original still-owned label.
    for (const record of owned.values()) {
      let currentTarget = null;
      try {
        if (record.root.parentNode === record.rootParent && matches(record.root, record.scope.root) && safeElement(record.root)) {
          // Resolve with the CURRENT active/inactive class variants after React
          // changes selection, without adopting text it wrote concurrently.
          const fields = fieldsForScope(record.scope, record.root);
          const field = fields && fields.find((candidate, index) =>
            record.key === record.scope.id + '/' + (candidate.id || index));
          if (field) currentTarget = resolve(record.root, field);
        }
      } catch (_) { /* fail closed */ }
      // A moved/replaced/excluded target or changed value belongs to the App.
      if (currentTarget && currentTarget.element === record.element && currentTarget.node === record.node &&
          readValue(record) === record.translated) {
        try {
          writeValue(record, record.original);
          restored += 1;
        } catch (_) { preserved += 1; }
      } else preserved += 1;
    }
    owned.clear();
    restored += restoreContent();
    return { restored, preserved };
  }

  function fail(error) {
    drainExternalWrites();
    stopObserving();
    const restored = restoreOwned();
    dependencies.clear();
    lastFailure = { code: error.status, reason: error.reason };
    return status(error.status, error.reason, restored);
  }

  function routeCandidate(mutation) {
    if (mutation.type !== 'childList') return false;
    return [...mutation.addedNodes].some((node) => {
      if (!node || node.nodeType !== 1 || !safeElement(node)) return false;
      const cls = typeof node.getAttribute === 'function' ? (node.getAttribute('class') || '') : '';
      if (cls.includes('settings-modal-container') || (typeof node.querySelector === 'function' && node.querySelector('.settings-modal-container'))) return true;
      return scopes.some((scope) => matches(node, scope.root) ||
        (typeof node.querySelectorAll === 'function' && node.querySelectorAll(rootSelector(scope)).length > 0));
    });
  }

  function watch() {
    if (!observer) {
      observer = new host.MutationObserver((mutations) => {
        if (!active || disposed) return;
        releaseExternalWrites(mutations);
        if (!mutations.some((mutation) => dependencies.has(mutation.target) || routeCandidate(mutation) || (contentContainer && (mutation.target === contentContainer || (typeof contentContainer.contains === 'function' && contentContainer.contains(mutation.target)))))) return;
        if (pendingTimer === null) {
          pendingTimer = host.setTimeout(() => {
            pendingTimer = null;
            if (active && !disposed) apply();
          }, 0);
        }
      });
    }
    const attributeFilter = [...new Set([...OBSERVED_ATTRIBUTES,
      ...scopes.flatMap((scope) => Object.keys(scope.root.attributes || {})),
      ...scopes.flatMap((scope) => (scope.fields || []).flatMap((field) =>
        field.path.flatMap((anchor) => Object.keys(anchor.attributes || {})))), 'type',
    ])];
    // Never observe document-wide text. Structural insertions discover routes;
    // filtered identity/guard attributes invalidate already-known dependencies.
    // The callback never reads arbitrary attribute values or user text.
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter });
    for (const { root } of observedScopes) {
      observer.observe(root, {
        subtree: true, childList: true, characterData: true, characterDataOldValue: true,
        attributes: true, attributeOldValue: true, attributeFilter,
      });
      for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        if (parent !== doc.documentElement) observer.observe(parent, { childList: true, attributes: true, attributeFilter });
      }
    }
    const container = findContentContainer();
    if (container) {
      observer.observe(container, {
        subtree: true, childList: true, characterData: true, characterDataOldValue: true,
      });
    }
    // Keep document-level route/guard observation when it is also an ancestor.
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter });
  }

  function probe() {
    drainExternalWrites();
    try {
      const result = inspect();
      if (result.error) return result.error;
      scopeStatuses = result.scopeStatuses;
      return status('supported', null, { labelCount: result.targets.length });
    } catch (_) {
      return status('runtime_error', 'DOM inspection failed');
    }
  }

  function apply() {
    drainExternalWrites();
    clearTimer();
    try {
      const result = inspect();
      if (result.error) return disposed ? result.error : fail(result.error);
      if (observer) observer.disconnect();
      // Stable per-scope keys prevent ownership migrating to another route.
      const targetsByKey = new Map(result.targets.map((target) => [target.key, target]));
      for (const [key, record] of owned) {
        const target = targetsByKey.get(key);
        if (!target || record.node !== target.node || record.element !== target.element || record.root !== target.root) owned.delete(key);
      }
      observedScopes = result.scopes;
      scopeStatuses = result.scopeStatuses;
      dependencies = result.dependencies;
      for (const target of result.targets) {
        if (owned.has(target.key)) continue;
        const translated = exact[target.field.source];
        if (translated === target.field.source) continue;
        const record = { ...target, original: target.field.source, translated };
        owned.set(target.key, record);
        writeValue(target, translated);
      }
      translateContent();
      active = true;
      lastFailure = null;
      watch();
      // Only initial apply starts a lease. Observer reapply does not renew it.
      if (leaseTimer === null) armLease();
      return status('applied', null);
    } catch (_) {
      return fail(status('runtime_error', 'DOM update failed; owned changes were reverted where safe'));
    }
  }

  function renewLease() {
    if (disposed) return status('disposed', disposedReason);
    if (!active) return status('inactive', 'Apply successfully before renewing a lease');
    // Each explicit renewal revalidates exact roots and supports route changes.
    const result = apply();
    if (!result.active) return result;
    armLease();
    return status('applied', null, { leaseMs: LEASE_MS });
  }

  function armLease() {
    if (leaseTimer !== null) host.clearTimeout(leaseTimer);
    leaseTimer = host.setTimeout(() => {
      leaseTimer = null;
      dispose('lease_expired');
    }, LEASE_MS);
  }

  function dispose(reason) {
    drainExternalWrites();
    stopObserving();
    const restored = restoreOwned();
    dependencies.clear();
    observedScopes = [];
    observer = null;
    disposed = true;
    disposedReason = reason === 'lease_expired' ? reason : disposedReason;
    if (host && host[REGISTRY_KEY] === api) delete host[REGISTRY_KEY];
    return status('disposed', disposedReason, restored);
  }

  api = Object.freeze({
    brand: BRAND, probe, apply, dispose, renewLease,
    describe: () => ({
      appVersion, adapterId: adapter ? adapter.id : null, leaseMs: LEASE_MS, renewEveryMs: 3000,
      navigationCandidateEnabled: false,
      scopes: scopes.map((scope) => ({ id: scope.id, selector: rootSelector(scope),
        verification: scope.verification || 'offline-fixture', optional: !!scope.optional,
        sources: scope.kind === 'settings-navigation' ? [...VERIFIED_NAV_SOURCES]
          : scope.fields.map((field) => field.source),
        ...(scope.kind === 'settings-navigation' ? {
          untranslatedSources: Object.keys(KNOWN_NAV_LABELS)
            .filter((key) => !VERIFIED_NAV_KEYS.has(key)).map((key) => KNOWN_NAV_LABELS[key]),
        } : {}) })),
    }),
    getStatus: () => disposed ? status('disposed', disposedReason) : lastFailure
      ? status(lastFailure.code, lastFailure.reason) : status(active ? 'applied' : 'inactive'),
  });
  const previous = host && host[REGISTRY_KEY];
  if (previous) {
    if (previous.brand !== BRAND || typeof previous.dispose !== 'function') {
      configError = 'An unknown controller already occupies the localization registry';
      return api;
    }
    previous.dispose();
  }
  if (host) host[REGISTRY_KEY] = api;
  return api;
})
