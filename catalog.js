// Shared catalogue of fault categories, fault types and supported cities.
// The server validates against it and the front-end builds its menus from it (GET /api/catalog).
// `icon` is a Font Awesome 6 Free "solid" class suffix (e.g. 'bolt' -> fa-solid fa-bolt),
// rendered as a crisp vector icon of the real object rather than an emoji.

const CATEGORIES = {
  electricity: {
    label: 'Electricity (ZESA)',
    color: '#FFC53D',
    icon: 'bolt',
    types: {
      cable_stolen:     { label: 'Cables stolen',            icon: 'scissors' },
      pole_down:        { label: 'Pole or line down',        icon: 'tower-broadcast' },
      transformer:      { label: 'Transformer faulty',       icon: 'plug-circle-exclamation' },
      exposed_wires:    { label: 'Exposed live wires',       icon: 'bolt-lightning' },
      outage:           { label: 'Power outage',             icon: 'plug-circle-xmark' },
      streetlight:      { label: 'Street light not working', icon: 'lightbulb-slash' }
    }
  },
  water: {
    label: 'Water',
    color: '#22D3EE',
    icon: 'droplet',
    types: {
      burst_pipe:       { label: 'Burst pipe',               icon: 'droplet' },
      leakage:          { label: 'Water leakage',             icon: 'faucet-drip' },
      no_water:         { label: 'No water supply',          icon: 'droplet-slash' },
      sewer:            { label: 'Sewer overflow',            icon: 'water' },
      open_manhole:     { label: 'Open or missing manhole',  icon: 'circle-exclamation' }
    }
  },
  roads: {
    label: 'Roads',
    color: '#FF7849',
    icon: 'road',
    types: {
      pothole:          { label: 'Large pothole',            icon: 'road-circle-exclamation' },
      road_damage:      { label: 'Damaged or washed-out road', icon: 'triangle-exclamation' },
      traffic_light:    { label: 'Traffic light not working', icon: 'traffic-light' },
      flooding:         { label: 'Flooded road',              icon: 'cloud-showers-heavy' },
      fallen_tree:      { label: 'Fallen tree or debris',     icon: 'tree' }
    }
  },
  accident: {
    label: 'Accidents',
    color: '#FF4D6D',
    icon: 'car-burst',
    types: {
      collision:        { label: 'Road accident',            icon: 'car-burst' },
      breakdown:        { label: 'Broken-down vehicle blocking road', icon: 'car-side' },
      pedestrian:       { label: 'Pedestrian involved',       icon: 'person-walking' },
      roadblock:        { label: 'Road blocked',              icon: 'road-barrier' }
    }
  },
  other: {
    label: 'Other',
    color: '#9AA5B1',
    icon: 'triangle-exclamation',
    types: {
      other:            { label: 'Other hazard',              icon: 'triangle-exclamation' }
    }
  }
};

// [latitude, longitude] of each city centre (used to centre the map)
const CITIES = {
  'Harare':         [-17.8292, 31.0522],
  'Bulawayo':       [-20.1325, 28.6265],
  'Chitungwiza':    [-18.0127, 31.0755],
  'Mutare':         [-18.9707, 32.6709],
  'Gweru':          [-19.4500, 29.8167],
  'Kwekwe':         [-18.9281, 29.8149],
  'Kadoma':         [-18.3328, 29.9150],
  'Masvingo':       [-20.0744, 30.8328],
  'Chinhoyi':       [-17.3667, 30.2000],
  'Norton':         [-17.8833, 30.7000],
  'Marondera':      [-18.1853, 31.5519],
  'Ruwa':           [-17.8894, 31.2447],
  'Epworth':        [-17.8900, 31.1475],
  'Bindura':        [-17.3019, 31.3306],
  'Chegutu':        [-18.1300, 30.1400],
  'Karoi':          [-16.8100, 29.6900],
  'Rusape':         [-18.5300, 32.1300],
  'Victoria Falls': [-17.9243, 25.8572],
  'Hwange':         [-18.3667, 26.5000],
  'Beitbridge':     [-22.2167, 30.0000],
  'Gwanda':         [-20.9333, 29.0167],
  'Zvishavane':     [-20.3333, 30.0333],
  'Kariba':         [-16.5167, 28.8000],
  'Chipinge':       [-20.1883, 32.6236]
};

module.exports = { CATEGORIES, CITIES };
