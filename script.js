// ------------------------------------------------------------------
// 오늘 뭐 입지? - Open-Meteo 날씨 + 공공데이터포털 에어코리아 미세먼지
// ------------------------------------------------------------------

const els = {
  form: document.getElementById("search-form"),
  input: document.getElementById("city-input"),
  geoBtn: document.getElementById("geo-btn"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  weatherIcon: document.getElementById("weather-icon"),
  temp: document.getElementById("temp"),
  feelsLike: document.getElementById("feels-like"),
  locationName: document.getElementById("location-name"),
  weatherDesc: document.getElementById("weather-desc"),
  humidity: document.getElementById("humidity"),
  wind: document.getElementById("wind"),
  outfitIcon: document.getElementById("outfit-icon"),
  outfitTitle: document.getElementById("outfit-title"),
  outfitTop: document.getElementById("outfit-top"),
  outfitSleeve: document.getElementById("outfit-sleeve"),
  outfitThickness: document.getElementById("outfit-thickness"),
  outfitBottom: document.getElementById("outfit-bottom"),
  outfitOuter: document.getElementById("outfit-outer"),
  outfitOuterRow: document.getElementById("outfit-outer-row"),
  outfitList: document.getElementById("outfit-list"),
  outfitExtra: document.getElementById("outfit-extra"),
  pm10Value: document.getElementById("pm10-value"),
  pm10Grade: document.getElementById("pm10-grade"),
  pm25Value: document.getElementById("pm25-value"),
  pm25Grade: document.getElementById("pm25-grade"),
  maskIcon: document.getElementById("mask-icon"),
  maskText: document.getElementById("mask-text"),
  airNote: document.getElementById("air-note"),
};

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const city = els.input.value.trim();
  if (!city) return;
  runForCity(city);
});

// 첫 진입 시 기본값(서울)으로 자동 검색
if (els.input.value.trim()) {
  runForCity(els.input.value.trim());
}

els.geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showStatus("이 브라우저는 위치 정보를 지원하지 않아요.", true);
    return;
  }
  showStatus("내 위치를 확인하는 중...");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        await runForCoords(pos.coords.latitude, pos.coords.longitude);
      } catch (err) {
        console.error(err);
        showStatus("정보를 불러오는 중 오류가 발생했어요.", true);
      }
    },
    () => showStatus("위치 정보를 가져올 수 없어요. 도시 이름으로 검색해 주세요.", true)
  );
});

function showStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.hidden = false;
  els.status.classList.toggle("error", isError);
}

function hideStatus() {
  els.status.hidden = true;
}

// ------------------------------------------------------------------
// 도시 이름 검색 흐름
// ------------------------------------------------------------------
async function runForCity(city) {
  els.result.hidden = true;
  showStatus(`"${city}" 검색 중...`);
  try {
    const place = await geocodeCity(city);
    if (!place) {
      showStatus(`"${city}"에 해당하는 도시를 찾을 수 없어요.`, true);
      return;
    }
    const nameParts = [place.name];
    if (place.admin1 && place.admin1 !== place.name) nameParts.push(place.admin1);
    await loadAndRender({
      lat: place.latitude,
      lon: place.longitude,
      displayName: nameParts.join(", "),
      sidoRaw: place.admin1 || place.name,
    });
  } catch (err) {
    console.error(err);
    showStatus("정보를 불러오는 중 오류가 발생했어요.", true);
  }
}

async function runForCoords(lat, lon) {
  showStatus("현재 위치의 날씨를 불러오는 중...");
  let displayName = "내 위치";
  let sidoRaw = "";
  try {
    const rev = await reverseGeocode(lat, lon);
    if (rev) {
      displayName = [rev.city, rev.principalSubdivision].filter(Boolean).join(", ") || displayName;
      sidoRaw = rev.principalSubdivision || "";
    }
  } catch (err) {
    console.warn("역지오코딩 실패", err);
  }
  await loadAndRender({ lat, lon, displayName, sidoRaw });
}

async function loadAndRender({ lat, lon, displayName, sidoRaw }) {
  const weather = await getWeather(lat, lon);
  renderWeather(weather, displayName);
  renderOutfit(weather);

  hideStatus();
  els.result.hidden = false;

  // 미세먼지는 실패해도 나머지 화면은 보여준다.
  try {
    await renderAirQuality(sidoRaw);
  } catch (err) {
    console.warn("미세먼지 정보를 불러오지 못했어요", err);
    renderAirUnavailable("미세먼지 정보를 불러오지 못했어요.");
  }
}

// ------------------------------------------------------------------
// Open-Meteo: 지오코딩 + 날씨
// ------------------------------------------------------------------
async function geocodeCity(city) {
  // Open-Meteo의 지오코딩 검색은 한글 지명을 지원하지 않아 Nominatim(OSM)을 사용한다.
  const best = await searchNominatim(city);
  if (!best) return null;
  const addr = best.address || {};
  return {
    latitude: parseFloat(best.lat),
    longitude: parseFloat(best.lon),
    name: addr.city || addr.town || addr.county || best.name,
    admin1: addr.province || addr.state || addr.city || "",
  };
}

async function searchNominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    q
  )}&format=json&accept-language=ko&limit=8&addressdetails=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  // 행정구역(시/도/군) 결과를 우선하고, 그 중 중요도가 가장 높은 것을 선택한다.
  const preferred = data.filter((d) => d.class === "boundary" || d.class === "place");
  const pool = preferred.length ? preferred : data;
  pool.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  return pool[0];
}

async function reverseGeocode(lat, lon) {
  // BigDataCloud의 무료 역지오코딩 API (키 불필요, CORS 허용)
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    city: data.city || data.locality || "",
    principalSubdivision: data.principalSubdivision || "",
  };
}

async function getWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
    `&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("weather fetch failed");
  const data = await res.json();
  return data.current;
}

function renderWeather(current, displayName) {
  const desc = describeWeatherCode(current.weather_code);
  els.weatherIcon.textContent = desc.icon;
  els.temp.textContent = `${Math.round(current.temperature_2m)}°`;
  els.feelsLike.textContent = `체감 ${Math.round(current.apparent_temperature)}°`;
  els.locationName.textContent = displayName;
  els.weatherDesc.textContent = desc.label;
  els.humidity.textContent = `${Math.round(current.relative_humidity_2m)}%`;
  els.wind.textContent = `${Math.round(current.wind_speed_10m)} km/h`;
}

function describeWeatherCode(code) {
  const table = {
    0: { icon: "☀️", label: "맑음" },
    1: { icon: "🌤️", label: "대체로 맑음" },
    2: { icon: "⛅", label: "구름 조금" },
    3: { icon: "☁️", label: "흐림" },
    45: { icon: "🌫️", label: "안개" },
    48: { icon: "🌫️", label: "짙은 안개" },
    51: { icon: "🌦️", label: "약한 이슬비" },
    53: { icon: "🌦️", label: "이슬비" },
    55: { icon: "🌦️", label: "강한 이슬비" },
    61: { icon: "🌧️", label: "약한 비" },
    63: { icon: "🌧️", label: "비" },
    65: { icon: "🌧️", label: "강한 비" },
    66: { icon: "🌧️", label: "약한 얼어붙는 비" },
    67: { icon: "🌧️", label: "강한 얼어붙는 비" },
    71: { icon: "🌨️", label: "약한 눈" },
    73: { icon: "🌨️", label: "눈" },
    75: { icon: "❄️", label: "강한 눈" },
    77: { icon: "❄️", label: "싸락눈" },
    80: { icon: "🌦️", label: "약한 소나기" },
    81: { icon: "🌧️", label: "소나기" },
    82: { icon: "🌧️", label: "강한 소나기" },
    85: { icon: "🌨️", label: "약한 소나기눈" },
    86: { icon: "🌨️", label: "강한 소나기눈" },
    95: { icon: "⛈️", label: "뇌우" },
    96: { icon: "⛈️", label: "우박을 동반한 뇌우" },
    99: { icon: "⛈️", label: "강한 우박을 동반한 뇌우" },
  };
  return table[code] || { icon: "🌡️", label: "알 수 없음" };
}

// ------------------------------------------------------------------
// 옷차림 추천
// ------------------------------------------------------------------
function renderOutfit(current) {
  const t = current.apparent_temperature;
  const outfit = getOutfit(t);
  els.outfitIcon.textContent = outfit.icon;
  els.outfitTitle.textContent = outfit.title;
  els.outfitTop.textContent = outfit.top;
  els.outfitSleeve.textContent = outfit.sleeve;
  els.outfitThickness.textContent = outfit.thickness;
  els.outfitBottom.textContent = outfit.bottom;
  if (outfit.outer) {
    els.outfitOuter.textContent = outfit.outer;
    els.outfitOuterRow.hidden = false;
  } else {
    els.outfitOuterRow.hidden = true;
  }

  els.outfitList.innerHTML = "";
  const accessories = outfit.accessories || [];
  accessories.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    els.outfitList.appendChild(li);
  });
  els.outfitList.hidden = accessories.length === 0;

  const extras = [];
  const code = current.weather_code;
  if ([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) {
    extras.push("우산을 꼭 챙기세요 ☔");
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    extras.push("눈길이 미끄러울 수 있어요, 방수 신발을 추천해요 ❄️");
  }
  if (current.wind_speed_10m >= 30) {
    extras.push("바람이 강하게 불어요, 바람막이를 추가하면 좋아요 💨");
  }
  els.outfitExtra.textContent = extras.join(" · ");
}

function getOutfit(t) {
  if (t >= 28) {
    return {
      icon: "🩳",
      title: "한여름 옷차림",
      top: "민소매 또는 반팔",
      sleeve: "반팔",
      thickness: "얇은 소재",
      bottom: "반바지",
      outer: null,
      accessories: ["시원한 소재의 원피스도 좋아요"],
    };
  }
  if (t >= 23) {
    return {
      icon: "👕",
      title: "더운 여름 옷차림",
      top: "반팔 티셔츠",
      sleeve: "반팔",
      thickness: "얇은 소재",
      bottom: "반바지 또는 얇은 면바지",
      outer: null,
      accessories: ["린넨 소재 셔츠 추천"],
    };
  }
  if (t >= 20) {
    return {
      icon: "👚",
      title: "선선한 옷차림",
      top: "얇은 긴팔 티셔츠, 셔츠",
      sleeve: "긴팔",
      thickness: "얇은 소재",
      bottom: "긴바지 (면바지, 슬랙스)",
      outer: "얇은 가디건 (선택)",
      accessories: [],
    };
  }
  if (t >= 17) {
    return {
      icon: "🧥",
      title: "가벼운 겉옷이 필요해요",
      top: "얇은 니트, 맨투맨",
      sleeve: "긴팔",
      thickness: "보통 두께",
      bottom: "긴바지 (청바지, 면바지)",
      outer: "가디건 또는 청재킷",
      accessories: [],
    };
  }
  if (t >= 12) {
    return {
      icon: "🧥",
      title: "쌀쌀한 날씨",
      top: "니트, 맨투맨",
      sleeve: "긴팔",
      thickness: "보통 두께",
      bottom: "긴바지 (청바지, 면바지)",
      outer: "자켓 또는 가디건",
      accessories: ["가벼운 스카프"],
    };
  }
  if (t >= 9) {
    return {
      icon: "🧣",
      title: "제법 추운 날씨",
      top: "니트, 맨투맨",
      sleeve: "긴팔",
      thickness: "두꺼운 소재",
      bottom: "기모 안감 긴바지",
      outer: "코트, 자켓",
      accessories: [],
    };
  }
  if (t >= 5) {
    return {
      icon: "🧤",
      title: "추운 날씨",
      top: "히트텍 등 내복 + 니트",
      sleeve: "긴팔",
      thickness: "두꺼운 소재",
      bottom: "두꺼운 긴바지",
      outer: "두꺼운 코트, 플리스",
      accessories: ["목도리", "장갑"],
    };
  }
  return {
    icon: "🥶",
    title: "한파! 완전 무장하세요",
    top: "내복 + 두꺼운 니트",
    sleeve: "긴팔",
    thickness: "매우 두꺼운 소재",
    bottom: "기모 레깅스 + 두꺼운 긴바지",
    outer: "패딩, 두꺼운 코트",
    accessories: ["목도리", "장갑", "방한모"],
  };
}

// ------------------------------------------------------------------
// 공공데이터포털: 에어코리아 시도별 실시간 미세먼지
// ------------------------------------------------------------------
const SIDO_RULES = [
  { keys: ["서울", "seoul"], name: "서울" },
  { keys: ["부산", "busan"], name: "부산" },
  { keys: ["대구", "daegu"], name: "대구" },
  { keys: ["인천", "incheon"], name: "인천" },
  { keys: ["광주", "gwangju"], name: "광주" },
  { keys: ["대전", "daejeon"], name: "대전" },
  { keys: ["울산", "ulsan"], name: "울산" },
  { keys: ["세종", "sejong"], name: "세종" },
  { keys: ["경기", "gyeonggi"], name: "경기" },
  { keys: ["강원", "gangwon"], name: "강원" },
  { keys: ["충북", "충청북도", "chungcheongbuk", "chungbuk"], name: "충북" },
  { keys: ["충남", "충청남도", "chungcheongnam", "chungnam"], name: "충남" },
  { keys: ["전북", "전라북도", "jeollabuk", "jeonbuk"], name: "전북" },
  { keys: ["전남", "전라남도", "jeollanam", "jeonnam"], name: "전남" },
  { keys: ["경북", "경상북도", "gyeongsangbuk", "gyeongbuk"], name: "경북" },
  { keys: ["경남", "경상남도", "gyeongsangnam", "gyeongnam"], name: "경남" },
  { keys: ["제주", "jeju"], name: "제주" },
];

function normalizeSido(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase();
  for (const rule of SIDO_RULES) {
    if (rule.keys.some((k) => s.includes(k))) return rule.name;
  }
  return null;
}

async function renderAirQuality(sidoRaw) {
  const sido = normalizeSido(sidoRaw);

  if (!sido) {
    renderAirUnavailable("이 지역은 시/도 미세먼지 정보를 찾을 수 없어요 (국내 지역만 지원).");
    return;
  }

  // 공공데이터포털 인증키는 서버(.env)에만 보관되며, 프론트엔드는 우리 서버의
  // /api/air-quality 엔드포인트만 호출한다 (server.js 참고).
  const url = `/api/air-quality?sido=${encodeURIComponent(sido)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (res.status === 503) {
    renderAirUnavailable("서버에 공공데이터포털 인증키가 설정되어 있지 않아요. .env의 AIRKOREA_SERVICE_KEY를 확인해주세요.");
    return;
  }
  if (!res.ok) throw new Error(`air quality fetch failed: ${data?.error || res.status}`);

  const header = data?.response?.header;
  if (!header || header.resultCode !== "00") {
    throw new Error(`airkorea error: ${header?.resultMsg || "unknown"}`);
  }

  const items = data.response.body?.items || [];
  const pm10Values = items.map((i) => Number(i.pm10Value)).filter((n) => Number.isFinite(n));
  const pm25Values = items.map((i) => Number(i.pm25Value)).filter((n) => Number.isFinite(n));

  if (pm10Values.length === 0 && pm25Values.length === 0) {
    renderAirUnavailable("현재 측정 가능한 미세먼지 데이터가 없어요.");
    return;
  }

  const pm10 = average(pm10Values);
  const pm25 = average(pm25Values);

  const pm10Grade = gradePM10(pm10);
  const pm25Grade = gradePM25(pm25);

  setAirValue(els.pm10Value, els.pm10Grade, pm10, pm10Grade);
  setAirValue(els.pm25Value, els.pm25Grade, pm25, pm25Grade);

  const worst = worstGrade(pm10Grade, pm25Grade);
  const mask = maskRecommendation(worst);
  els.maskIcon.textContent = mask.icon;
  els.maskText.textContent = mask.text;
  els.airNote.textContent = `${sido} 지역 측정소 ${items.length}곳 평균값 기준`;
}

function renderAirUnavailable(message) {
  els.pm10Value.textContent = "-";
  els.pm25Value.textContent = "-";
  setGradeBadge(els.pm10Grade, null);
  setGradeBadge(els.pm25Grade, null);
  els.maskIcon.textContent = "❔";
  els.maskText.textContent = "미세먼지 정보 없음";
  els.airNote.textContent = message;
}

function setAirValue(valueEl, gradeEl, value, grade) {
  valueEl.textContent = Number.isFinite(value) ? `${Math.round(value)} ㎍/m³` : "-";
  setGradeBadge(gradeEl, grade);
}

function setGradeBadge(el, grade) {
  el.classList.remove("good", "normal", "bad", "very-bad", "unknown");
  if (!grade) {
    el.textContent = "-";
    el.classList.add("unknown");
    return;
  }
  el.textContent = grade.label;
  el.classList.add(grade.cls);
}

function average(arr) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function gradePM10(v) {
  if (!Number.isFinite(v)) return null;
  if (v <= 30) return { level: 1, label: "좋음", cls: "good" };
  if (v <= 80) return { level: 2, label: "보통", cls: "normal" };
  if (v <= 150) return { level: 3, label: "나쁨", cls: "bad" };
  return { level: 4, label: "매우나쁨", cls: "very-bad" };
}

function gradePM25(v) {
  if (!Number.isFinite(v)) return null;
  if (v <= 15) return { level: 1, label: "좋음", cls: "good" };
  if (v <= 35) return { level: 2, label: "보통", cls: "normal" };
  if (v <= 75) return { level: 3, label: "나쁨", cls: "bad" };
  return { level: 4, label: "매우나쁨", cls: "very-bad" };
}

function worstGrade(a, b) {
  const candidates = [a, b].filter(Boolean);
  if (candidates.length === 0) return null;
  return candidates.reduce((worst, g) => (g.level > worst.level ? g : worst));
}

function maskRecommendation(grade) {
  if (!grade) return { icon: "❔", text: "미세먼지 정보 없음" };
  switch (grade.level) {
    case 4:
      return { icon: "😷", text: "외출을 자제하고, 나가야 한다면 KF94 이상 마스크를 착용하세요." };
    case 3:
      return { icon: "😷", text: "보건용 마스크(KF94) 착용을 권장해요." };
    case 2:
      return { icon: "🙂", text: "민감군(어린이·노약자·호흡기질환자)은 마스크 착용을 고려하세요." };
    default:
      return { icon: "😊", text: "마스크 없이 외출해도 좋은 날이에요." };
  }
}
