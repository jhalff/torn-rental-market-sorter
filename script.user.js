
 // ==UserScript==
 // @name         TORN Rental Market Sorter
 // @namespace    https://www.torn.com/
 // @version      9.0.0
 // @description  All-page rental market sorter with stable listing navigation.
 // @match        https://www.torn.com/properties.php?step=rentalmarket*
 // @grant        none
 // ==/UserScript==

(() => {
    'use strict';

    if (window.top !== window.self) return;

    const ROOT_ID = 'tm-rental-sorter';
    const STYLE_ID = 'tm-rental-sorter-style';
    const PAGE_SIZE = 20;
    const MAX_PAGES = 100;
    const TIMEOUT = 25000;
    const NAV_KEY = 'tm-rental-target';

    let allProperties = [];
    let isCollecting = false;
    let frame = null;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function money(value) {
        return value == null
            ? '—'
            : '$' + Number(value).toLocaleString('en-US');
    }

    function numberFrom(element) {
        if (!element) return null;
        const digits = element.textContent.replace(/[^0-9]/g, '');
        return digits ? Number(digits) : null;
    }

    function getData(row, pageStart = 0) {
        const ownerLink = row.querySelector('.userinfo a.name');
        const priceButton = row.querySelector(
            '.confirm-rent .yes-btn[data-price], ' +
            '.confirm-deal .yes-btn[data-price]'
        );

        const images = [
            ...(row.querySelector('.userinfo')?.querySelectorAll('img') || [])
        ].map(img => ({
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') || ''
        }));

        return {
            id: priceButton?.dataset.id || '',
            pageStart,
            owner: ownerLink?.textContent.trim() || 'Unknown',
            ownerUrl: ownerLink?.getAttribute('href') || '',
            happiness: numberFrom(row.querySelector('.happiness')),
            price: priceButton?.dataset.price !== undefined
                ? Number(priceButton.dataset.price)
                : null,
            daily: numberFrom(row.querySelector('.cost-per-day')),
            period: numberFrom(row.querySelector('.rental-period')),
            images
        };
    }

    function createElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${ROOT_ID}, #${ROOT_ID} * { color: #f1f1f1; }
            #${ROOT_ID} { margin: 12px 0; font-size: 12px; }
            #${ROOT_ID} .tm-toolbar {
                display:flex; align-items:end; flex-wrap:wrap; gap:10px;
                padding:10px; margin-bottom:8px;
                border:1px solid #555; border-radius:4px; background:#292929;
            }
            #${ROOT_ID} .tm-heading { width:100%; font-size:13px; color:#fff; }
            #${ROOT_ID} .tm-field { display:flex; flex-direction:column; gap:4px; }
            #${ROOT_ID} input, #${ROOT_ID} select, #${ROOT_ID} button {
                box-sizing:border-box; max-width:100%; min-height:29px;
                color:#fff !important; background:#3b3b3b !important;
                border:1px solid #666 !important;
            }
            #${ROOT_ID} input { width:115px; padding:4px 6px; }
            #${ROOT_ID} input::placeholder { color:#bbb !important; opacity:1; }
            #${ROOT_ID} select option { color:#fff; background:#303030; }
            #${ROOT_ID} button { padding:4px 9px; cursor:pointer; }
            #${ROOT_ID} button:hover { background:#505050 !important; }
            #${ROOT_ID} .tm-results { margin:6px 2px; color:#ddd !important; font-size:11px; }
            #${ROOT_ID} .tm-table-wrap { width:100%; overflow-x:auto; }
            #${ROOT_ID} .tm-table {
                width:100%; border-collapse:collapse; table-layout:auto;
                background:#303030; color:#f1f1f1 !important; font-size:12px;
            }
            #${ROOT_ID} .tm-table th {
                padding:8px 10px; color:#fff !important; text-align:left;
                white-space:nowrap; background:linear-gradient(#414141, #292929);
                border:1px solid #202020;
            }
            #${ROOT_ID} .tm-table td {
                padding:5px 10px; height:30px; color:#eee !important;
                border:1px solid #242424; white-space:nowrap;
            }
            #${ROOT_ID} .tm-table tbody tr { background:#353535; cursor:pointer; }
            #${ROOT_ID} .tm-table tbody tr:nth-child(even) { background:#303030; }
            #${ROOT_ID} .tm-table tbody tr:hover { background:#484848; }
            #${ROOT_ID} .tm-number { text-align:right; font-variant-numeric:tabular-nums; }
            #${ROOT_ID} .tm-owner-cell { min-width:170px; }
            #${ROOT_ID} .tm-owner { color:#fff !important; font-weight:600; }
            #${ROOT_ID} .tm-owner-images {
                display:inline-flex; align-items:center; gap:4px;
                margin-right:6px; vertical-align:middle;
            }
            #${ROOT_ID} .tm-owner-images img {
                max-width:190px; max-height:26px; object-fit:contain; vertical-align:middle;
            }
            #${ROOT_ID} .tm-table a { color:#fff !important; text-decoration:none; }
            #${ROOT_ID} .tm-table a:hover { text-decoration:underline; }
            #${ROOT_ID} .tm-actions { text-align:center; }
            #${ROOT_ID} .tm-empty { padding:18px; text-align:center; }
            #${ROOT_ID} .tm-loading {
                padding:12px; margin-bottom:8px; color:#eee !important;
                background:#303030; border:1px solid #444;
            }
            @media (max-width:650px) {
                #${ROOT_ID} .tm-table { min-width:650px; }
            }
        `;
        document.head.appendChild(style);
    }

    function createTable() {
        const wrap = createElement('div', 'tm-table-wrap');
        const table = createElement('table', 'tm-table');
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');

        ['Owner', 'Happiness', 'Cost', 'Cost per Day', 'Rental Period', 'Profile']
            .forEach((label, index) => {
                tr.append(createElement('th', index > 0 && index < 5 ? 'tm-number' : '', label));
            });

        thead.append(tr);
        const tbody = document.createElement('tbody');
        tbody.id = 'tm-list';
        table.append(thead, tbody);
        wrap.append(table);
        return wrap;
    }

    function addNumberField(label, id, placeholder) {
        const field = createElement('label', 'tm-field');
        field.append(createElement('span', '', label));

        const input = createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.placeholder = placeholder;
        input.id = id;
        field.append(input);

        return { field, input };
    }

    function build() {
        const market = document.querySelector('.market-table');
        if (!market || document.getElementById(ROOT_ID)) return;

        installStyle();

        const root = createElement('section');
        root.id = ROOT_ID;

        const toolbar = createElement('div', 'tm-toolbar');
        toolbar.append(createElement('strong', 'tm-heading', 'Rental market filters'));

        const sortField = createElement('label', 'tm-field');
        sortField.append(createElement('span', '', 'Sort by'));

        const sort = createElement('select');
        sort.id = 'tm-sort-order';

        [
            ['price-asc', 'Cost: lowest first'],
            ['price-desc', 'Cost: highest first'],
            ['daily-asc', 'Per day: lowest first'],
            ['daily-desc', 'Per day: highest first'],
            ['period-desc', 'Rental period: longest first'],
            ['happiness-desc', 'Happiness: highest first']
        ].forEach(([value, label]) => {
            const option = createElement('option', '', label);
            option.value = value;
            sort.append(option);
        });

        sortField.append(sort);

        const minPrice = addNumberField('Minimum cost', 'tm-min-price', '$0');
        const maxPrice = addNumberField('Maximum cost', 'tm-max-price', 'No limit');
        const minHappy = addNumberField('Minimum happiness', 'tm-min-happiness', 'Any');
        const minDays = addNumberField('Minimum days', 'tm-min-days', 'Any');

        const refresh = createElement('button', '', 'Refresh all pages');
        refresh.type = 'button';

        const reset = createElement('button', '', 'Reset filters');
        reset.type = 'button';

        toolbar.append(
            sortField, minPrice.field, maxPrice.field,
            minHappy.field, minDays.field, refresh, reset
        );

        const status = createElement('div', 'tm-results', 'Preparing collection…');
        status.id = 'tm-status';

        const loading = createElement('div', 'tm-loading', 'Collecting rental listings…');
        loading.id = 'tm-loading';

        root.append(toolbar, status, loading, createTable());
        market.prepend(root);

        [sort, minPrice.input, maxPrice.input, minHappy.input, minDays.input]
            .forEach(input => input.addEventListener(
                input.tagName === 'SELECT' ? 'change' : 'input',
                render
            ));

        refresh.addEventListener('click', collectAllPages);

        reset.addEventListener('click', () => {
            minPrice.input.value = '';
            maxPrice.input.value = '';
            minHappy.input.value = '';
            minDays.input.value = '';
            sort.value = 'price-asc';
            render();
        });

        render();
        collectAllPages();
    }

    function render() {
        const list = document.getElementById('tm-list');
        const status = document.getElementById('tm-status');
        if (!list || !status) return;

        const read = id => document.getElementById(id).value;
        const min = read('tm-min-price') === '' ? 0 : Number(read('tm-min-price'));
        const max = read('tm-max-price') === '' ? Infinity : Number(read('tm-max-price'));
        const happiness = read('tm-min-happiness') === '' ? 0 : Number(read('tm-min-happiness'));
        const days = read('tm-min-days') === '' ? 0 : Number(read('tm-min-days'));
        const sort = read('tm-sort-order');

        const filtered = allProperties.filter(item =>
            item.price !== null && Number.isFinite(item.price) &&
            item.price >= min && item.price <= max &&
            (item.happiness ?? 0) >= happiness &&
            (item.period ?? 0) >= days
        );

        const sorters = {
            'price-asc': (a, b) => a.price - b.price,
            'price-desc': (a, b) => b.price - a.price,
            'daily-asc': (a, b) => (a.daily ?? Infinity) - (b.daily ?? Infinity),
            'daily-desc': (a, b) => (b.daily ?? -Infinity) - (a.daily ?? -Infinity),
            'period-desc': (a, b) => (b.period ?? 0) - (a.period ?? 0),
            'happiness-desc': (a, b) => (b.happiness ?? 0) - (a.happiness ?? 0)
        };

        filtered.sort(sorters[sort] || sorters['price-asc']);

        const fragment = document.createDocumentFragment();

        for (const item of filtered) {
            const tr = document.createElement('tr');
            tr.tabIndex = 0;
            tr.title = 'Open this rental listing in Torn';

            const ownerCell = createElement('td', 'tm-owner-cell');
            const images = createElement('span', 'tm-owner-images');

            for (const image of item.images || []) {
                if (!image.src) continue;
                const img = document.createElement('img');
                img.src = image.src;
                img.alt = image.alt;
                img.loading = 'lazy';
                images.append(img);
            }

            if (images.childElementCount) ownerCell.append(images);

            if (item.ownerUrl) {
                const link = createElement('a', 'tm-owner', item.owner);
                link.href = item.ownerUrl;
                link.addEventListener('click', event => event.preventDefault());
                ownerCell.append(link);
            } else {
                ownerCell.append(createElement('span', 'tm-owner', item.owner));
            }

            tr.append(ownerCell);

            [
                item.happiness == null ? '—' : item.happiness.toLocaleString('en-US'),
                money(item.price),
                money(item.daily),
                item.period == null ? '—' : `${item.period} days`
            ].forEach(value => tr.append(createElement('td', 'tm-number', value)));

            const profile = createElement('td', 'tm-actions');

            if (item.ownerUrl) {
                const link = createElement('a', '', 'View profile');
                link.href = item.ownerUrl;
                link.addEventListener('click', event => event.stopPropagation());
                profile.append(link);
            } else {
                profile.textContent = '—';
            }

            tr.append(profile);

            const open = () => openOriginalListing(item);
            tr.addEventListener('click', open);
            tr.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });

            fragment.append(tr);
        }

        if (!filtered.length) {
            const tr = document.createElement('tr');
            const td = createElement('td', 'tm-empty',
                allProperties.length ? 'No properties match your filters.' : 'No properties collected yet.');
            td.colSpan = 6;
            tr.append(td);
            fragment.append(tr);
        }

        list.replaceChildren(fragment);
        status.textContent =
            `${filtered.length.toLocaleString()} matching properties out of ` +
            `${allProperties.length.toLocaleString()} collected`;
    }

    function getPropertyId() {
        return location.hash.match(/property=(\d+)/)?.[1] || '13';
    }

    function openOriginalListing(item) {
        // Remember the target in this tab so it survives Torn's SPA navigation.
        const target = {
            id: item.id,
            owner: item.owner,
            pageStart: item.pageStart || 0
        };

        try {
            sessionStorage.setItem(NAV_KEY, JSON.stringify(target));
        } catch (_) {}

        location.hash = `#/property=${getPropertyId()}&start=${target.pageStart}`;
    }

    function findTargetRow() {
        let target;

        try {
            target = JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null');
        } catch (_) {
            target = null;
        }

        if (!target) return null;

        const rows = [
            ...document.querySelectorAll('.market-table .users-list.rental > li')
        ];

        return rows.find(row => {
            const button = row.querySelector(
                '.confirm-rent .yes-btn[data-price], .confirm-deal .yes-btn[data-price]'
            );

            if (target.id && button?.dataset.id === target.id) return true;

            return row.querySelector('.userinfo a.name')
                ?.textContent.trim() === target.owner;
        });
    }

    function restoreTargetListing() {
        const target = findTargetRow();
        if (!target) return false;

        // Remove the saved target first, preventing repeat scrolls when Torn
        // performs additional DOM updates.
        try {
            sessionStorage.removeItem(NAV_KEY);
        } catch (_) {}

        const expander = target.querySelector(
            '.expander-info, .expand, [role="button"]'
        );

        if (expander) expander.click();

        // Wait for the expansion/layout to settle before the single scroll.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                target.scrollIntoView({
                    behavior: 'auto',
                    block: 'center'
                });
            });
        });

        return true;
    }

    function installNavigationRestore() {
        let attempts = 0;

        const observer = new MutationObserver(() => {
            if (restoreTargetListing()) {
                observer.disconnect();
            } else if (++attempts > 150) {
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also check immediately in case Torn has already rendered the target.
        if (restoreTargetListing()) observer.disconnect();
    }

    function propertyId() {
        return getPropertyId();
    }

    function pageHash(start) {
        return `#/property=${propertyId()}&start=${start}`;
    }

    function readFrameRows() {
        return frame?.contentDocument
            ? [...frame.contentDocument.querySelectorAll('.market-table .users-list.rental > li')]
            : [];
    }

    function signature(rows) {
        return rows.map(row => {
            const button = row.querySelector(
                '.confirm-rent .yes-btn[data-price], .confirm-deal .yes-btn[data-price]'
            );
            return button?.dataset.id ||
                row.querySelector('.userinfo a.name')?.textContent.trim() || '';
        }).join('|');
    }

    async function waitForRows(previousSignature, startedAt) {
        while (Date.now() - startedAt < TIMEOUT) {
            const rows = readFrameRows();
            const current = signature(rows);

            if (rows.length && current && current !== previousSignature) {
                await sleep(300);
                return readFrameRows();
            }

            await sleep(200);
        }

        throw new Error('Timed out waiting for rental listings to render.');
    }

    async function navigateToPage(start, previousSignature) {
        const startedAt = Date.now();
        const targetHash = pageHash(start);

        if (!frame.contentDocument?.querySelector('.market-table')) {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('Timed out opening rental market.')),
                    TIMEOUT
                );

                frame.onload = () => {
                    clearTimeout(timer);
                    resolve();
                };

                frame.src =
                    `${location.origin}/properties.php?step=rentalmarket${targetHash}`;
            });
        } else {
            frame.contentWindow.location.hash = targetHash;
        }

        return waitForRows(previousSignature, startedAt);
    }

    async function collectAllPages() {
        if (isCollecting) return;
        isCollecting = true;
        allProperties = [];

        const status = document.getElementById('tm-status');
        const loading = document.getElementById('tm-loading');

        if (loading) {
            loading.style.display = 'block';
            loading.textContent = 'Collecting listings from all pages…';
        }

        cleanupFrame();

        frame = document.createElement('iframe');
        frame.title = 'Rental market collector';
        frame.setAttribute('aria-hidden', 'true');

        Object.assign(frame.style, {
            position: 'fixed',
            width: '1px',
            height: '1px',
            left: '-10px',
            top: '-10px',
            opacity: '0',
            pointerEvents: 'none',
            border: '0'
        });

        document.body.append(frame);

        const seen = new Set();
        let pagesLoaded = 0;
        let complete = false;
        let previousSignature = null;

        try {
            for (let page = 0; page < MAX_PAGES; page++) {
                const start = page * PAGE_SIZE;
                let rows;

                try {
                    rows = await navigateToPage(start, previousSignature);
                } catch (error) {
                    if (status) {
                        status.textContent =
                            `Collection stopped at page ${page + 1}: ${error.message}`;
                    }
                    break;
                }

                if (!rows.length) {
                    complete = true;
                    break;
                }

                const currentSignature = signature(rows);

                if (page > 0 && currentSignature === previousSignature) {
                    complete = true;
                    break;
                }

                previousSignature = currentSignature;
                let added = 0;

                for (const row of rows) {
                    const item = getData(row, start);
                    const key = item.id
                        ? `id:${item.id}`
                        : `${item.owner}|${item.price}|${item.period}|${item.daily}|${item.happiness}`;

                    if (seen.has(key)) continue;
                    seen.add(key);
                    allProperties.push(item);
                    added++;
                }

                pagesLoaded++;
                render();

                if (status) {
                    status.textContent =
                        `Loading page ${page + 1}: ${allProperties.length} unique properties collected…`;
                }

                if (rows.length < PAGE_SIZE) {
                    complete = true;
                    break;
                }

                if (added === 0) {
                    if (status) {
                        status.textContent =
                            `Stopped at page ${page + 1}: no new properties found.`;
                    }
                    break;
                }
            }

            if (complete && status) {
                status.textContent =
                    `Collection complete: ${allProperties.length} unique properties from ${pagesLoaded} page(s).`;
            } else if (pagesLoaded === MAX_PAGES && status) {
                status.textContent =
                    `Reached the ${MAX_PAGES}-page limit; ${allProperties.length} properties collected.`;
            }
        } finally {
            isCollecting = false;
            cleanupFrame();
            if (loading) loading.style.display = 'none';
            render();
        }
    }

    function cleanupFrame() {
        if (frame) {
            frame.remove();
            frame = null;
        }
    }

    function init() {
        if (!location.pathname.endsWith('/properties.php')) return;
        if (new URLSearchParams(location.search).get('step') !== 'rentalmarket') return;

        build();
        installNavigationRestore();
    }

    function build() {
        if (document.getElementById(ROOT_ID)) return;

        const market = document.querySelector('.market-table');
        if (!market) return;

        installStyle();

        const root = createElement('section');
        root.id = ROOT_ID;

        const toolbar = createElement('div', 'tm-toolbar');
        toolbar.append(createElement('strong', 'tm-heading', 'Rental market filters'));

        const sortField = createElement('label', 'tm-field');
        sortField.append(createElement('span', '', 'Sort by'));

        const sort = createElement('select');
        sort.id = 'tm-sort-order';

        [
            ['price-asc', 'Cost: lowest first'],
            ['price-desc', 'Cost: highest first'],
            ['daily-asc', 'Per day: lowest first'],
            ['daily-desc', 'Per day: highest first'],
            ['period-desc', 'Rental period: longest first'],
            ['happiness-desc', 'Happiness: highest first']
        ].forEach(([value, label]) => {
            const option = createElement('option', '', label);
            option.value = value;
            sort.append(option);
        });

        sortField.append(sort);

        const minPrice = addNumberField('Minimum cost', 'tm-min-price', '$0');
        const maxPrice = addNumberField('Maximum cost', 'tm-max-price', 'No limit');
        const minHappy = addNumberField('Minimum happiness', 'tm-min-happiness', 'Any');
        const minDays = addNumberField('Minimum days', 'tm-min-days', 'Any');

        const refresh = createElement('button', '', 'Refresh all pages');
        refresh.type = 'button';

        const reset = createElement('button', '', 'Reset filters');
        reset.type = 'button';

        toolbar.append(sortField, minPrice.field, maxPrice.field, minHappy.field, minDays.field, refresh, reset);

        const status = createElement('div', 'tm-results', 'Preparing collection…');
        status.id = 'tm-status';

        const loading = createElement('div', 'tm-loading', 'Collecting rental listings…');
        loading.id = 'tm-loading';

        root.append(toolbar, status, loading, createTable());
        market.prepend(root);

        [sort, minPrice.input, maxPrice.input, minHappy.input, minDays.input]
            .forEach(input => input.addEventListener(
                input.tagName === 'SELECT' ? 'change' : 'input',
                render
            ));

        refresh.addEventListener('click', collectAllPages);

        reset.addEventListener('click', () => {
            minPrice.input.value = '';
            maxPrice.input.value = '';
            minHappy.input.value = '';
            minDays.input.value = '';
            sort.value = 'price-asc';
            render();
        });

        render();
        collectAllPages();
    }

    const observer = new MutationObserver(() => {
        if (!document.getElementById(ROOT_ID)) init();
        restoreTargetListing();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    init();
})();
