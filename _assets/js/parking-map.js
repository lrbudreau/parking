$(document).ready(function () {
  // Only run on pages that have the map (e.g. not the About page)
  if (!document.getElementById('map')) return;

  const CAMPUS_CENTER = [40.4237, -86.9212];
  const NEAREST_COUNT = 5;
  const WALK_METERS_PER_MIN = 80; // ~3 mph walking pace

  const ARCGIS = 'https://services1.arcgis.com/mLNdQKiKsj5Z5YMN/arcgis/rest/services';
  const LOTS_URL = `${ARCGIS}/SurfaceParkingLots/FeatureServer/0`;
  const BUILDINGS_URL = `${ARCGIS}/BuildingShapes_view/FeatureServer/0`;
  const ACCESSIBLE_URL = `${ARCGIS}/HandicapVehicleSpaces/FeatureServer/0`;

  // Readable names for Purdue's LOT_PERM codes, taken from the legend of
  // Purdue's own campus parking map (Surface_Parking_Lots renderer).
  // Codes not listed here (e.g. NPR, SCG) are shown as-is.
  const PERMIT_LABELS = {
    A: 'A',
    B: 'B',
    C: 'C',
    R: 'Residence Halls (R)',
    RG: 'Residence Halls (RG)',
    FSCL: 'Restricted Residential',
    M: 'Paid Parking (M)',
    GGPP: 'Paid Parking (garage)',
    SP: 'Special Permit (SP)',
    RE: 'Special Permit (RE)',
    VAL: 'Value Permit',
    CONT: 'Contractor',
    UV: 'University Vehicle',
    SG: 'Student Garage',
    Other: 'Other / unknown'
  };
  const permitLabel = code => PERMIT_LABELS[code] || code;

  // "ABC" means the lot has A, B and/or C spaces, so a C permit holder should
  // see it when filtering for C. Other codes (SP, NPR, GGPP...) stay whole.
  function parsePermits(code) {
    const parts = (code || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const permits = [];
    parts.forEach(p => {
      if (/^[ABC]+$/.test(p)) permits.push(...p.split(''));
      else permits.push(p);
    });
    return permits.length ? [...new Set(permits)] : ['Other'];
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- DOM ----------
  const passTypeSelect = document.getElementById('passType');
  const buildingSelect = document.getElementById('building');
  const accessibleToggle = document.getElementById('accessibleToggle');
  const locateButton = document.getElementById('locateButton');
  const statusMessage = document.getElementById('statusMessage');
  const resultsPanel = document.getElementById('results');

  // Load errors stay visible; other messages (e.g. "no lots match") come and go
  const loadErrors = [];
  function showStatus(text) {
    const message = [...loadErrors, text].filter(Boolean).join(' ');
    statusMessage.textContent = message;
    statusMessage.hidden = !message;
  }
  function reportLoadError(text) {
    loadErrors.push(text);
    showStatus('');
  }
  showStatus('');

  // Settings from the URL (?pass=A&bldg=LWSN) take priority over the saved pass type
  const params = new URLSearchParams(window.location.search);
  let savedPass = params.get('pass');
  if (savedPass === null) {
    try { savedPass = localStorage.getItem('parkingPassType'); } catch (e) { savedPass = null; }
  }
  const initialBuilding = params.get('bldg');

  // ---------- Map ----------
  const map = L.map('map').setView(CAMPUS_CENTER, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const legendControl = L.control({ position: 'bottomleft' });
  legendControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'info legend');
    div.id = 'legend';
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  legendControl.addTo(map);
  const legendDiv = document.getElementById('legend');

  // ---------- Colors ----------
  const palette = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
    '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5'
  ];
  const colorFor = {};
  let colorIndex = 0;
  function getColor(key) {
    if (!colorFor[key]) colorFor[key] = palette[colorIndex++ % palette.length];
    return colorFor[key];
  }

  // ---------- Parking lots ----------
  // Each entry: { layer, permits, groupKey, name, desc, center }
  const lots = [];
  const lotsLayer = L.featureGroup().addTo(map);
  let highlighted = new Set();

  function baseStyle(lot) {
    const isNear = highlighted.has(lot);
    return {
      color: isNear ? '#cfb991' : '#000',
      weight: isNear ? 4 : 1,
      fillColor: getColor(lot.groupKey),
      fillOpacity: isNear ? 0.7 : 0.4
    };
  }

  function addLot(feature, layer, { name, desc, permitCode, note }) {
    const permits = parsePermits(permitCode);
    const lot = {
      layer,
      permits,
      groupKey: permits.join(' / '),
      name: name || 'Parking lot',
      desc,
      garageName: (/^(.*Garage)\s+Level\s+\d+/i.exec(desc || '') || [])[1] || null,
      center: layer.getBounds().getCenter()
    };
    const directions = `https://www.google.com/maps/dir/?api=1&destination=${lot.center.lat},${lot.center.lng}`;
    layer.bindPopup(`
      <b>${escapeHtml(lot.name)}</b><br>
      Permits: ${escapeHtml(permits.map(permitLabel).join(', '))}<br>
      ${desc ? `Description: ${escapeHtml(desc)}<br>` : ''}
      ${note ? `<em>${escapeHtml(note)}</em><br>` : ''}
      <a href="${directions}" target="_blank" rel="noopener">Get directions</a>
    `);
    layer.on('mouseover', () => layer.bringToFront());
    lots.push(lot);
    return lot;
  }

  let lotsLoaded = 0;
  function onLotsLoaded() {
    lotsLoaded++;
    if (lotsLoaded < 2) return; // wait for both the live layer and the garages file
    buildPassTypeOptions();
    updateLegend();
    applyFilters();
  }

  L.esri.query({ url: LOTS_URL })
    .where('1=1')
    .fields(['LOT_PERM', 'LotName', 'LotDesc'])
    .run((error, featureCollection) => {
      if (error) {
        console.error('Error loading parking data:', error);
        reportLoadError('Couldn’t load parking lots from Purdue’s map service. Please try again later.');
      } else {
        L.geoJSON(featureCollection, {
          onEachFeature: (feature, layer) => {
            const p = feature.properties;
            addLot(feature, layer, { name: p.LotName, desc: p.LotDesc, permitCode: p.LOT_PERM });
          }
        });
      }
      onLotsLoaded();
    });

  // Garages missing from Purdue's surface-lot layer (outlines are approximate)
  fetch('data/garages.geojson')
    .then(res => res.json())
    .then(data => {
      L.geoJSON(data, {
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          addLot(feature, layer, {
            name: p.name,
            desc: p.address,
            permitCode: (p.type || []).join(','),
            note: 'Garage outline is approximate.'
          });
        }
      });
    })
    .catch(err => console.error('Error loading garages:', err))
    .finally(onLotsLoaded);

  function buildPassTypeOptions() {
    const all = new Set();
    lots.forEach(l => l.permits.forEach(p => all.add(p)));
    const sorted = [...all].sort((a, b) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
    passTypeSelect.innerHTML = '<option value="">All pass types</option>';
    sorted.forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = permitLabel(code);
      passTypeSelect.appendChild(opt);
    });
    if (savedPass && all.has(savedPass)) passTypeSelect.value = savedPass;
  }

  function updateLegend() {
    const groups = [...new Set(lots.map(l => l.groupKey))].sort();
    // Collapsible so it doesn't cover the map on phones (closed there by default)
    legendDiv.innerHTML = '';
    const details = document.createElement('details');
    details.open = window.innerWidth > 768;
    const summary = document.createElement('summary');
    summary.textContent = 'Lot permits';
    details.appendChild(summary);
    legendDiv.appendChild(details);
    groups.forEach(key => {
      const item = document.createElement('div');
      item.className = 'legend-entry';
      const swatch = document.createElement('span');
      swatch.className = 'legend-item';
      swatch.style.backgroundColor = getColor(key);
      const label = document.createElement('span');
      label.textContent = key.split(' / ').map(permitLabel).join(' / ');
      item.append(swatch, label);
      details.appendChild(item);
    });
  }

  // ---------- Buildings ----------
  let buildingLayer = null;
  const buildingsByAbbr = new Map();
  let selectedBuildingAbbr = null;

  function buildingStyle(feature) {
    const isSelected = feature.properties.BLDG_ABBR === selectedBuildingAbbr;
    return {
      color: isSelected ? '#0000ff' : '#666',
      weight: isSelected ? 3 : 0.5,
      opacity: isSelected ? 1 : 0.6
    };
  }

  $('#building').select2({ placeholder: 'Search for a building', allowClear: true, width: 'style' });

  L.esri.query({ url: BUILDINGS_URL })
    .where('1=1')
    .fields(['BLDG_ABBR', 'BUILDING_N'])
    .run((error, featureCollection) => {
      if (error) {
        console.error('Error loading building data:', error);
        reportLoadError('Couldn’t load campus buildings from Purdue’s map service.');
        return;
      }
      buildingLayer = L.geoJSON(featureCollection, {
        style: buildingStyle,
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          if (p.BLDG_ABBR && !buildingsByAbbr.has(p.BLDG_ABBR)) buildingsByAbbr.set(p.BLDG_ABBR, { feature, layer });
          if (p.BUILDING_N) layer.bindTooltip(p.BLDG_ABBR ? `(${p.BLDG_ABBR}) ${p.BUILDING_N}` : p.BUILDING_N);
        }
      }).addTo(map);
      buildingLayer.bringToBack();

      buildingSelect.innerHTML = '<option value=""></option>';
      [...buildingsByAbbr.values()]
        .filter(b => b.feature.properties.BUILDING_N)
        .sort((a, b) => a.feature.properties.BLDG_ABBR.localeCompare(b.feature.properties.BLDG_ABBR))
        .forEach(({ feature }) => {
          const { BLDG_ABBR, BUILDING_N } = feature.properties;
          const opt = document.createElement('option');
          opt.value = BLDG_ABBR;
          opt.textContent = `(${BLDG_ABBR}) ${BUILDING_N}`;
          buildingSelect.appendChild(opt);
        });

      if (initialBuilding && buildingsByAbbr.has(initialBuilding)) {
        $('#building').val(initialBuilding).trigger('change');
      } else {
        $('#building').trigger('change.select2');
      }
    });

  // ---------- Origin: a building or the user's location ----------
  let origin = null; // { latlng, label }
  let userMarker = null;

  function buildingChanged() {
    const abbr = buildingSelect.value;
    selectedBuildingAbbr = abbr || null;
    if (buildingLayer) buildingLayer.setStyle(buildingStyle);

    if (!abbr) {
      if (origin && origin.type === 'building') origin = null;
    } else {
      const item = buildingsByAbbr.get(abbr);
      if (item) {
        origin = {
          type: 'building',
          latlng: item.layer.getBounds().getCenter(),
          label: item.feature.properties.BUILDING_N || abbr
        };
        if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
      }
    }
    applyFilters({ fit: true });
  }
  $('#building').on('change', buildingChanged);

  locateButton.addEventListener('click', () => {
    locateButton.disabled = true;
    locateButton.textContent = 'Locating…';
    map.locate({ enableHighAccuracy: true, timeout: 10000 });
  });
  map.on('locationfound', e => {
    locateButton.disabled = false;
    locateButton.textContent = 'Use my location';
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 })
      .bindTooltip('You are here').addTo(map);
    origin = { type: 'location', latlng: e.latlng, label: 'your location' };
    selectedBuildingAbbr = null;
    $('#building').val(null).trigger('change.select2');
    if (buildingLayer) buildingLayer.setStyle(buildingStyle);
    applyFilters({ fit: true });
  });
  map.on('locationerror', () => {
    locateButton.disabled = false;
    locateButton.textContent = 'Use my location';
    showStatus('Couldn’t get your location. Check that location access is allowed for this site.');
  });

  // ---------- Filtering and nearest lots ----------
  function formatDistance(meters) {
    const minutes = Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
    const dist = meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
    return `${dist} · ~${minutes} min walk`;
  }

  function applyFilters({ fit = false } = {}) {
    const pass = passTypeSelect.value;
    const visible = lots.filter(l => !pass || l.permits.includes(pass));

    lotsLayer.clearLayers();
    visible.forEach(l => lotsLayer.addLayer(l.layer));

    highlighted = new Set();
    let nearest = [];
    if (origin) {
      // Purdue stores each garage floor as its own record ("Grant Street Garage
      // Level 3"), so list each garage once and highlight all of its levels.
      const seen = new Set();
      nearest = visible
        .map(l => ({ lot: l, meters: map.distance(origin.latlng, l.center) }))
        .sort((a, b) => a.meters - b.meters)
        .filter(n => {
          const key = n.lot.garageName || n.lot;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, NEAREST_COUNT);
      nearest.forEach(n => {
        if (n.lot.garageName) {
          visible.filter(l => l.garageName === n.lot.garageName).forEach(l => highlighted.add(l));
        } else {
          highlighted.add(n.lot);
        }
      });
    }
    lots.forEach(l => l.layer.setStyle(baseStyle(l)));
    nearest.forEach(n => n.lot.layer.bringToFront());

    renderResults(nearest, pass, visible.length);
    if (lots.length) {
      showStatus(visible.length === 0 ? 'No lots match that pass type.' : '');
    }

    if (fit && origin && nearest.length) {
      const bounds = L.latLngBounds([origin.latlng, ...nearest.map(n => n.lot.center)]);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    } else if (fit && !origin) {
      map.setView(CAMPUS_CENTER, 15);
    }

    // Keep the URL shareable and remember the pass type
    const url = new URL(window.location.href);
    pass ? url.searchParams.set('pass', pass) : url.searchParams.delete('pass');
    selectedBuildingAbbr ? url.searchParams.set('bldg', selectedBuildingAbbr) : url.searchParams.delete('bldg');
    history.replaceState(null, '', url);
    try { localStorage.setItem('parkingPassType', pass); } catch (e) { /* storage unavailable */ }
  }

  function renderResults(nearest, pass, visibleCount) {
    resultsPanel.innerHTML = '';
    if (!origin) {
      resultsPanel.hidden = true;
      return;
    }
    resultsPanel.hidden = false;

    const heading = document.createElement('h2');
    heading.textContent = `Closest lots to ${origin.label}` + (pass ? ` for ${permitLabel(pass)}` : '');
    resultsPanel.appendChild(heading);

    if (!nearest.length) {
      const p = document.createElement('p');
      p.textContent = visibleCount ? 'Loading lots…' : 'No lots match that pass type.';
      resultsPanel.appendChild(p);
      return;
    }

    const list = document.createElement('ol');
    nearest.forEach(({ lot, meters }) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'result-link';
      btn.textContent = lot.garageName
        ? lot.garageName
        : (lot.desc && lot.desc !== lot.name ? `${lot.name} – ${lot.desc}` : lot.name);
      btn.addEventListener('click', () => {
        map.fitBounds(lot.layer.getBounds(), { maxZoom: 18 });
        lot.layer.openPopup(lot.center);
      });
      const meta = document.createElement('div');
      meta.className = 'result-meta';
      meta.textContent = `${formatDistance(meters)} · ${lot.permits.map(permitLabel).join(', ')}`;
      const dir = document.createElement('a');
      dir.href = `https://www.google.com/maps/dir/?api=1&destination=${lot.center.lat},${lot.center.lng}`;
      dir.target = '_blank';
      dir.rel = 'noopener';
      dir.textContent = 'Directions';
      li.append(btn, meta, dir);
      list.appendChild(li);
    });
    resultsPanel.appendChild(list);

    const note = document.createElement('p');
    note.className = 'result-note';
    note.textContent = 'Distances are straight-line. Always check the posted signs: a lot may hold several kinds of spaces.';
    resultsPanel.appendChild(note);
  }

  passTypeSelect.addEventListener('change', () => applyFilters({ fit: !!origin }));

  // ---------- Construction ----------
  fetch('data/construction.geojson')
    .then(res => res.json())
    .then(data => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const active = data.features.filter(f => !f.properties.endDate || new Date(f.properties.endDate) >= today);
      if (!active.length) return;
      L.geoJSON({ type: 'FeatureCollection', features: active }, {
        style: { color: 'red', weight: 3, dashArray: '5,5', fillOpacity: 0.2 },
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          layer.bindPopup(`<b>Construction:</b> ${escapeHtml(p.name)}<br>Expected until: ${escapeHtml(p.endDate || 'unknown')}`);
        }
      }).addTo(map);
    })
    .catch(err => console.error('Error loading construction data:', err));

  // ---------- Accessible parking ----------
  const accessibleIcon = L.icon({
    iconUrl: 'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1/svgs/solid/wheelchair.svg',
    iconSize: [20, 20],
    iconAnchor: [10, 20],
    popupAnchor: [0, -20]
  });
  const accessibleLayer = L.geoJSON(null, {
    pointToLayer: (feature, latlng) => L.marker(latlng, { icon: accessibleIcon, alt: 'Accessible parking space' }),
    onEachFeature: (feature, layer) => {
      const lot = feature.properties.LOT_NAME;
      layer.bindPopup(`Accessible parking space${lot ? '<br>Lot: ' + escapeHtml(lot) : ''}`);
    }
  });
  L.esri.query({ url: ACCESSIBLE_URL })
    .where('1=1')
    .fields(['LOT_NAME'])
    .run((error, featureCollection) => {
      if (error) {
        console.error('Error loading accessible parking data:', error);
        return;
      }
      accessibleLayer.addData(featureCollection);
    });
  if (accessibleToggle.checked) accessibleLayer.addTo(map);
  accessibleToggle.addEventListener('change', () => {
    accessibleToggle.checked ? map.addLayer(accessibleLayer) : map.removeLayer(accessibleLayer);
  });
});
