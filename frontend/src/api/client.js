const API_URL = import.meta.env.VITE_API_URL;

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export function getLatestReading(stationId = 1) {
  return request(`/stats/latest?station_id=${stationId}`);
}

export function getReadingsInRange(start, end, stationId = 1) {
  return request(`/stats/range?start=${start}&end=${end}&station_id=${stationId}`);
}

export function sendChatMessage(message, history = []) {
  return request("/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}
