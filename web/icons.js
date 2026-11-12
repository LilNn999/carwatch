/* Rounded icon shapes adapted from the approved desktop prototype. No demo logic. */
(() => {
  'use strict';
  const shapes = {
    overview: '<rect x="3" y="3" width="8" height="8" rx="2.8" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="2.8" fill="currentColor" opacity=".45"/><rect x="3" y="13" width="8" height="8" rx="2.8" fill="currentColor" opacity=".45"/><rect x="13" y="13" width="8" height="8" rx="2.8" fill="currentColor"/>',
    car: '<path d="M6 8l1-3a3 3 0 013-2h4a3 3 0 013 2l1 3" fill="currentColor" opacity=".5"/><rect x="2" y="8" width="20" height="12" rx="4.5" fill="currentColor"/><path d="M6 13h2m8 0h2" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M6 19v2m12-2v2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    layers: '<path d="M4 6l6-3a4 4 0 014 0l6 3q3 1.5 0 3l-6 3a4 4 0 01-4 0L4 9q-3-1.5 0-3" fill="currentColor"/><path d="M3 13l7 3a5 5 0 004 0l7-3M3 18l7 3a5 5 0 004 0l7-3" stroke="currentColor" opacity=".5" stroke-width="3" stroke-linecap="round"/>',
    compare: '<rect x="3" y="3" width="7" height="13" rx="3.5" fill="currentColor"/><rect x="14" y="8" width="7" height="13" rx="3.5" fill="currentColor" opacity=".5"/><path d="M4 20h5M15 4h5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    fuel: '<rect x="3" y="2" width="13" height="20" rx="4" fill="currentColor"/><rect x="6" y="5" width="7" height="6" rx="1.7" fill="#fff" opacity=".8"/><path d="M16 10h2l2 3v4q0 3 2 2V8l-3-3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M7 17h5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    upload: '<path d="M5 19a5 5 0 01-1-10 8 8 0 0115-1 5.5 5.5 0 010 11z" fill="currentColor" opacity=".35"/><path d="M12 18V6m-4 4 4-4 4 4" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
    folder: '<path d="M3 7a4 4 0 014-4h3l3 3h4a4 4 0 014 4v8a4 4 0 01-4 4H7a4 4 0 01-4-4z" fill="currentColor" opacity=".45"/><rect x="2" y="9" width="20" height="13" rx="4" fill="currentColor"/>',
    star: '<path d="M10 3q2-3 4 0l2 4 4 .7q3 .5 1 3l-3 3 .6 5q.5 3-2.5 1.5L12 18l-4.1 2.2q-3 1.5-2.5-1.5l.6-5-3-3q-2-2.5 1-3L8 7z" fill="currentColor"/>',
    shield: '<path d="M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5z" fill="currentColor" opacity=".3"/><path d="M8 12l3 3 5-6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="3"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
    settings: '<path d="m10 2-1 3-3 1-3-1-2 4 2 2v3l-2 2 2 4 3-1 3 1 1 3h4l1-3 3-1 3 1 2-4-2-2v-3l2-2-2-4-3 1-3-1-1-3z" fill="currentColor" opacity=".5"/><circle cx="12" cy="12.5" r="4" fill="currentColor"/>',
    download: '<path d="M4 15v3a3 3 0 003 3h10a3 3 0 003-3v-3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M12 3v12m-4-4 4 4 4-4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    close: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
    plus: '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
    check: '<circle cx="12" cy="12" r="10" fill="currentColor" opacity=".2"/><path d="m7 12 3 3 7-7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    alert: '<path d="M9 4q3-4 6 0l7 13q2 4-3 4H5q-5 0-3-4z" fill="currentColor" opacity=".2"/><path d="M12 8v5m0 4h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    edit: '<path d="M4 16 15 5a3 3 0 014 4L8 20l-5 1z" fill="currentColor" opacity=".75"/><path d="m13 7 4 4" stroke="#fff" stroke-width="2"/>',
    refresh: '<path d="M20 9a8 8 0 10-1 9M20 3v6h-6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    image: '<rect x="2" y="3" width="20" height="18" rx="4" fill="currentColor" opacity=".25"/><circle cx="8" cy="9" r="2" fill="currentColor"/><path d="m4 18 5-5 4 3 4-6 4 8" fill="currentColor" opacity=".8"/>',
    note: '<rect x="3" y="2" width="18" height="20" rx="4" fill="currentColor" opacity=".25"/><path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
  };
  window.CarWatchIcons = name => `<svg class="icon soft-icon" viewBox="0 0 24 24" aria-hidden="true">${shapes[name] || shapes.note}</svg>`;
})();
