const input = document.querySelector('#location-input');
const result = document.querySelector('#result');

const circuit = {
  state: 'closed',
  failureCount: 0,
  openUntil: 0,
};

function isCircuitOpen() {
  if (circuit.state !== 'open') return false;
  if (Date.now() >= circuit.openUntil) {
    circuit.state = 'closed';
    circuit.failureCount = 0;
    return false;
  }
  return true;
}

function recordSuccess() {
  circuit.failureCount = 0;
}

function recordFailure() {
  circuit.failureCount += 1;
  if (circuit.failureCount >= 3) {
    circuit.state = 'open';
    circuit.openUntil = Date.now() + 30000; 
  }
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastError;
}

window.addEventListener('DOMContentLoaded', () => {
  input.focus(); 
});

input.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  const query = sanatizeInput(input.value);
  if (!query || query.length < 2) {
    result.textContent = 'Please enter at least 2 characters.';
    return;
  }


  if (!navigator.onLine) {
    result.textContent = 'You appear to be offline. Check your connection.';
    input.value = '';
    return;
  }

  result.textContent = `Looking up ${query}…`;

  try {
    const place = await geocode(query);
    const weather = await fetchWeather(place.latitude, place.longitude);

    result.innerHTML = `
      <p class="text-slate-200">${place.name}, ${place.country}</p>
      <p class="text-5xl font-light text-white">${weather.current_weather.temperature}&deg;C</p>
      <p class="text-sm text-slate-400">Wind ${weather.current_weather.windspeed} km/h</p>
      <p class="text-xs text-slate-500">${new Date(
        weather.current_weather.time
      ).toLocaleString()}</p>
    `;
  } catch (error) {
    result.textContent = error.message;
    console.error("Weather APP Error:", error);
  } finally {
    input.value = '';
  }
});

async function geocode(query) {
  if (isCircuitOpen()) {
    throw new Error('Service is currently unavailable. Please try again later.');
  }
  const { name, hint } = parseLocationQuery(query);
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`;
  let response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    throw new Error(`Network error while looking up ${name}.`),
    recordFailure(),
    console.error("Geocode Error:", error);
  }
  if (!response.ok) {
    throw new Error(`Location ${name} lookup failed.`),
    recordFailure(),
    console.error("Geocode Error:", error);
  }

  const data = await response.json();
  if (!data.results || data.results.length === 0) {
    throw new Error('Could not find that place.'),
    console.error("Geocode Error:", error);
  }

  return pickBestResult(data.results, name, hint);
}

async function fetchWeather(lat, lon) {
  if (isCircuitOpen()) {
    throw new Error('Service is currently unavailable. Please try again later.');
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  let response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    throw new Error('Network error while fetching weather data.'),
    recordFailure(),
    console.error("Fetch Weather Error:", error);
  }
  if (!response.ok) {
    throw new Error('Weather request failed.'),
    recordFailure(),
    console.error("Fetch Weather Error:", error);
  }

  const data = await response.json();
  if (!data.current_weather) {
    throw new Error('Weather data unavailable.'),
    recordFailure(),
    console.error("Fetch Weather Error:", error);
  }
  return data;
}

function parseLocationQuery(query) {
  const parts = query.split(',').map((part) => part.trim()).filter(Boolean);
  const name = parts[0] || query;
  const hint = parts[1] || '';
  return { name, hint };
}

function pickBestResult(results, name, hint) {
  let filtered = results;
  const nameLower = name.toLowerCase();

  if (hint) {
    const hintLower = hint.toLowerCase();
    filtered = results.filter((result) => {
      const country = (result.country || '').toLowerCase();
      const admin1 = (result.admin1 || '').toLowerCase();
      const admin2 = (result.admin2 || '').toLowerCase();
      const code = (result.country_code || '').toLowerCase();

      return (
        country.includes(hintLower) ||
        admin1.includes(hintLower) ||
        admin2.includes(hintLower) ||
        code === hintLower
      );
    });
  }

  let pool;
  if (filtered.length > 0) {
    pool = filtered;
  } else {
    pool = results;
  }

  const exactMatches = [];
  for (const result of pool) {
    const candidateName = (result.name || '').toLowerCase();
    if (candidateName === nameLower) {
      exactMatches.push(result);
    }
  }

  let ranked;
  if (exactMatches.length > 0) {
    ranked = exactMatches;
  } else {
    ranked = pool;
  }

  const rankedCopy = ranked.slice();
  rankedCopy.sort((a, b) => {
    const populationA = a.population || 0;
    const populationB = b.population || 0;
    return populationB - populationA;
  });

  return rankedCopy[0];
}

function sanatizeInput(query) {
  return query.trim().toLowerCase().replace(/[<>]/g, '').slice(0, 100);
}
