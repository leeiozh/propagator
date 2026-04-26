const CONST = {
    R_EARTH: 6378137,
    SCALE: 1 / 6378137,
    SAT_SIZE: 0.022,
    OMEGA_EARTH: 7.2921159e-5,
    DT: 10,
    SIM_SPEED: 1.0
};

const TRAIL_LEN = 900;   // ~1.7 витка при 400 км
const PREFETCH = 200;   // запрашиваем продолжение за 200 шагов до конца

// =====================
// THREE.JS СЦЕНА
// =====================
const leftEl = document.getElementById("left");

const camera = new THREE.PerspectiveCamera(
    60, leftEl.clientWidth / leftEl.clientHeight, 0.1, 1000
);
camera.position.set(0, -3, 2);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(leftEl.clientWidth, leftEl.clientHeight);
leftEl.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
    const w = leftEl.clientWidth, h = leftEl.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

const orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 2, 3);
scene.add(sun);

const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshPhongMaterial({
        map: new THREE.TextureLoader().load("earth.jpg"),
        shininess: 15
    })
);
scene.add(earth);

scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.6, 0),
        new THREE.Vector3(0, 1.6, 0)
    ]),
    new THREE.LineBasicMaterial({color: 0xffcc00})
));

// =====================
// ВСПОМОГАТЕЛЬНОЕ
// =====================
function eciToThree(r) {
    return new THREE.Vector3(r[0] * CONST.SCALE, r[2] * CONST.SCALE, -r[1] * CONST.SCALE);
}

function planeColor(planeIdx, nPlanes) {
    const c = new THREE.Color();
    c.setHSL(planeIdx / nPlanes, 0.9, 0.55);
    return c;
}

// Прямоугольный свайт (Sentinel-1A IW: 250 км поперёк трека, надирное наведение)
function updateCoverageRect(mesh, satPos, prevPos) {
    const swathKm = parseFloat(document.getElementById("swath").value);
    const R_E_KM = CONST.R_EARTH / 1000;

    const nadir = satPos.clone().normalize();

    // Вдоль-трековое направление — из предыдущей позиции
    let along = new THREE.Vector3(0, 1, 0);
    if (prevPos && satPos.distanceTo(prevPos) > 1e-10) {
        along = satPos.clone().sub(prevPos);
    }
    // Убираем компоненту вдоль надира (проецируем на касательную плоскость)
    along.sub(nadir.clone().multiplyScalar(along.dot(nadir)));
    if (along.length() < 1e-10) {
        along = new THREE.Vector3(1, 0, 0);
        along.sub(nadir.clone().multiplyScalar(along.dot(nadir)));
    }
    along.normalize();

    // Поперёк-трековое направление
    const cross = nadir.clone().cross(along).normalize();

    // Полу-углы в радианах (малоугловое приближение: d/R)
    const halfCT = (swathKm / 2) / R_E_KM;
    const halfAT = (swathKm / 2) / R_E_KM;

    const N = 16;
    const pts = [];

    function pt(ctF, atF) {
        return nadir.clone()
            .add(cross.clone().multiplyScalar(ctF * halfCT))
            .add(along.clone().multiplyScalar(atF * halfAT))
            .normalize();
    }

    // Четыре стороны прямоугольника
    for (let k = 0; k < N; k++) pts.push(pt(-1 + 2 * k / (N - 1), 1)); // верх
    for (let k = 1; k < N; k++) pts.push(pt(1, 1 - 2 * k / (N - 1))); // право
    for (let k = 1; k < N; k++) pts.push(pt(1 - 2 * k / (N - 1), -1)); // низ
    for (let k = 1; k < N - 1; k++) pts.push(pt(-1, -1 + 2 * k / (N - 1))); // лево

    mesh.geometry.setFromPoints(pts);
    mesh._coveragePoints = pts;
}

// =====================
// СОСТОЯНИЕ
// =====================
let simTime = 0;
let activeSats = [];
let planeRings = [];
let simSpeed = 1.0;
let lastRevisitUpdate = -1;

function clearSim() {
    activeSats.forEach(s => {
        scene.remove(s.mesh);
        scene.remove(s.trailLine);
        scene.remove(s.coverageMesh);
    });
    planeRings.forEach(r => scene.remove(r));
    activeSats = [];
    planeRings = [];
}

// =====================
// ДОЗАПРОС К БЭКЕНДУ
// =====================
function fetchContinuation() {
    if (activeSats.length === 0) return;

    const satellites = activeSats.map(sat => ({
        r0: sat.lastR,
        v0: sat.lastV
    }));

    fetch("http://127.0.0.1:8000/simulate", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({satellites})
    })
        .then(r => r.json())
        .then(data => {
            data.trajectories.forEach(({positions, final_v}, idx) => {
                const sat = activeSats[idx];
                if (!sat) return;
                // Дописываем в буфер, не сбрасывая шаг
                sat.buffer.push(...positions);
                sat.lastV = final_v;
                sat.lastR = positions[positions.length - 1];
                sat.fetching = false;
            });
        });
}

// =====================
// ЗАПУСК
// =====================
function runSim() {
    clearSim();
    simTime = 0;

    for (let i = 0; i < lastSeen.length; i++) {
        lastSeen[i] = -1e9;
        isCovered[i] = false;
    }
    maxRevisitTime = 0;
    lastRevisitUpdate = -1;

    const params = getParams();
    const {planes, spp} = params;
    const constellation = generateConstellation(planes, spp);

    fetch("http://127.0.0.1:8000/simulate", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            a: params.a, e: params.e, i: params.i,
            satellites: constellation.map(s => ({raan: s.raan, nu: s.nu}))
        })
    })
        .then(r => r.json())
        .then(data => {
            // Кольца орбитальных плоскостей — из бэкенда
            (data.rings || []).forEach((ringPts, p) => {
                const color = planeColor(p, planes);
                const pts = ringPts.map(r => eciToThree(r));
                const ring = new THREE.LineLoop(
                    new THREE.BufferGeometry().setFromPoints(pts),
                    new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.25})
                );
                scene.add(ring);
                planeRings.push(ring);
            });

            // Спутники
            data.trajectories.forEach(({positions, final_v}, idx) => {
                const {planeIdx} = constellation[idx];
                const color = planeColor(planeIdx, planes);

                const mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(CONST.SAT_SIZE, 8, 8),
                    new THREE.MeshBasicMaterial({color})
                );
                scene.add(mesh);

                const trailBuf = new Float32Array(TRAIL_LEN * 3);
                const trailGeo = new THREE.BufferGeometry();
                trailGeo.setAttribute("position", new THREE.BufferAttribute(trailBuf, 3));
                trailGeo.setDrawRange(0, 0);
                const trailLine = new THREE.Line(
                    trailGeo,
                    new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.6})
                );
                scene.add(trailLine);

                const coverageMesh = new THREE.LineLoop(
                    new THREE.BufferGeometry(),
                    new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.35})
                );
                scene.add(coverageMesh);

                activeSats.push({
                    buffer: positions,        // скользящий буфер позиций с бэкенда
                    bufStep: 0,                // текущий шаг в buffer
                    lastR: positions[positions.length - 1],
                    lastV: final_v,
                    fetching: false,
                    trail: [],
                    planeIdx, color,
                    mesh, trailLine, coverageMesh
                });
            });
        });
}

// =====================
// АНИМАЦИЯ 3D
// =====================
function update3D() {
    // Проверяем, нужен ли групповой дозапрос (по первому спутнику)
    if (activeSats.length > 0) {
        const s0 = activeSats[0];
        const remaining = s0.buffer.length - s0.bufStep;
        if (!s0.fetching && remaining <= PREFETCH) {
            activeSats.forEach(s => s.fetching = true);
            fetchContinuation();
        }
    }

    activeSats.forEach(sat => {
        if (sat.bufStep >= sat.buffer.length) return; // ждём дозапроса

        const r = sat.buffer[sat.bufStep];
        if (!r || !isFinite(r[0]) || !isFinite(r[1]) || !isFinite(r[2])) {
            return;
        }
        sat.bufStep++;

        // Сдвигаем окно буфера чтобы не копить память
        if (sat.bufStep > 4000) {
            sat.buffer.splice(0, sat.bufStep);
            sat.bufStep = 0;
        }

        // Трек
        sat.trail.push({r, t: simTime});
        if (sat.trail.length > TRAIL_LEN) sat.trail.shift();

        // Меш спутника
        const pos3 = eciToThree(r);
        sat.mesh.position.copy(pos3);

        // Буфер трека
        const buf = sat.trailLine.geometry.attributes.position.array;
        sat.trail.forEach(({r: tr}, j) => {
            buf[j * 3] = tr[0] * CONST.SCALE;
            buf[j * 3 + 1] = tr[2] * CONST.SCALE;
            buf[j * 3 + 2] = -tr[1] * CONST.SCALE;
        });
        sat.trailLine.geometry.attributes.position.needsUpdate = true;
        sat.trailLine.geometry.setDrawRange(0, sat.trail.length);

        updateCoverageRect(sat.coverageMesh, pos3, sat.prevPos || null);
        sat.prevPos = pos3.clone();
    });
}

// =====================
// 2D КАРТА
// =====================
const container2d = document.getElementById("top2d");
const canvas2d = document.createElement("canvas");
canvas2d.style.display = "block";
container2d.appendChild(canvas2d);
const ctx = canvas2d.getContext("2d");

const containerNSR = document.getElementById("bottom");
const canvasNSR = document.createElement("canvas");
canvasNSR.style.display = "block";
containerNSR.appendChild(canvasNSR);
const ctxNSR = canvasNSR.getContext("2d");

function resizeNSR() {

    const dpr = window.devicePixelRatio || 1;

    const w = containerNSR.clientWidth;
    const h = containerNSR.clientHeight;

    canvasNSR.width = w * dpr;
    canvasNSR.height = h * dpr;

    canvasNSR.style.width = w + "px";
    canvasNSR.style.height = h + "px";

    ctxNSR.setTransform(dpr, 0, 0, dpr, 0, 0);
}

setTimeout(resizeNSR, 100);
window.addEventListener("resize", resizeNSR);

const NSR_RECT = {
    lonMin: 30 * Math.PI / 180,
    lonMax: 195 * Math.PI / 180,
    latMin: 60 * Math.PI / 180,
    latMax: 85 * Math.PI / 180
};

const NSR_NODES = [
    [33.3408, 69.4038],
    [59.1565, 76.267],
    [68.3354, 77.2731],
    [82.9644, 76.4474],
    [97.5933, 76.5145],
    [103.426, 77.9499],
    [113.943, 77.0179],
    [119.011, 75.5215],
    [132.588, 75.6879],
    [136.221, 76.5145],
    [148.0,   73.5],
    [170.27,  69.70],
    [191.1,   65.80],
    [195.0,   64.8],
];

function nsrLatAtLon(lonDeg) {

    for (let i = 0; i < NSR_NODES.length - 1; i++) {

        const [x1, y1] = NSR_NODES[i];
        const [x2, y2] = NSR_NODES[i + 1];

        if (lonDeg >= x1 && lonDeg <= x2) {
            const t = (lonDeg - x1) / (x2 - x1);
            return y1 + t * (y2 - y1);
        }
    }

    return null;
}

const revisitGrid = [];
const lastSeen = [];
const isCovered = [];
const ALLOW_TIME = 6 * 3600;
let maxRevisitTime = 0;

for (let lon = 30; lon <= 195; lon += 1) {

    const lat = nsrLatAtLon(lon);
    if (lat === null) continue;

    const lonRad = lon * Math.PI / 180;
    const latRad = lat * Math.PI / 180;

    revisitGrid.push({
        lon: lonRad,
        lat: latRad,

        // фиксированный вектор точки трассы в земной системе
        baseVec: [
            Math.cos(latRad) * Math.cos(lonRad),
            Math.cos(latRad) * Math.sin(lonRad),
            Math.sin(latRad)
        ]
    });

    lastSeen.push(-1e9);
    isCovered.push(false);
}

function vecNorm(r) {
    return Math.sqrt(r[0]*r[0] + r[1]*r[1] + r[2]*r[2]);
}

function isPointCoveredBySat(node, satR) {

    const satNorm = vecNorm(satR);

    const satUnit = [
        satR[0]/satNorm,
        satR[1]/satNorm,
        satR[2]/satNorm
    ];

    const th = CONST.OMEGA_EARTH * simTime;
    const c = Math.cos(th);
    const s = Math.sin(th);

    const bx = node.baseVec[0];
    const by = node.baseVec[1];
    const bz = node.baseVec[2];

    const ptUnit = [
        bx*c - by*s,
        bx*s + by*c,
        bz
    ];

    const dot =
        satUnit[0]*ptUnit[0] +
        satUnit[1]*ptUnit[1] +
        satUnit[2]*ptUnit[2];

    // ---- ТЕКУЩИЙ SWATH ИЗ ПОЛЗУНКА ----
    const alpha = (parseFloat(document.getElementById("swath").value) * 1000 / 2) / CONST.R_EARTH;

    return dot >= Math.cos(alpha);
}

function updateRevisitGrid() {

    if (simTime - lastRevisitUpdate < 10) return;
    lastRevisitUpdate = simTime;

    revisitGrid.forEach((node, idx) => {

        let covered = false;

        activeSats.forEach(sat => {
            if (sat.bufStep === 0 || sat.bufStep >= sat.buffer.length) return;

            const satR = sat.buffer[sat.bufStep - 1];

            if (isPointCoveredBySat(node, satR)) covered = true;
        });

        if (covered && !isCovered[idx] && lastSeen[idx] >= 0) {
            const gap = simTime - lastSeen[idx];
            if (gap > maxRevisitTime) maxRevisitTime = gap;
        }
        isCovered[idx] = covered;
        if (covered) lastSeen[idx] = simTime;
    });
}

function mercY(lat) {
    return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

function latLonToXY_NSR(lat, lon, w, h) {

    while (lon < 0) lon += 2 * Math.PI;
    while (lon > 2 * Math.PI) lon -= 2 * Math.PI;

    const x = (lon - NSR_RECT.lonMin) / (NSR_RECT.lonMax - NSR_RECT.lonMin) * w;

    const yMin = mercY(NSR_RECT.latMin);
    const yMax = mercY(NSR_RECT.latMax);
    const yVal = mercY(lat);

    const y = (yMax - yVal) / (yMax - yMin) * h;

    return {x, y};
}

const nsrMapImg = new Image();

nsrMapImg.onload = function () {
    console.log("NSR MAP LOADED", nsrMapImg.width, nsrMapImg.height);
};

nsrMapImg.src = "nsr_map.png?v=5";

function updateNSRMap() {

    const dpr = window.devicePixelRatio || 1;
    const w = canvasNSR.width / dpr;
    const h = canvasNSR.height / dpr;

    ctxNSR.clearRect(0, 0, w, h);

    // ---------- рисуем фоновую карту ----------
    if (nsrMapImg.naturalWidth > 0) {

        const imgW = nsrMapImg.naturalWidth;
        const imgH = nsrMapImg.naturalHeight;

        const imgAspect = imgW / imgH;
        const canvasAspect = w / h;

        let sx = 0, sy = 0, sw = imgW, sh = imgH;

        if (imgAspect > canvasAspect) {
            sw = imgH * canvasAspect;
            sx = (imgW - sw) / 2;
        } else {
            sh = imgW / canvasAspect;
            sy = (imgH - sh) / 2;
        }

        ctxNSR.drawImage(nsrMapImg, sx, sy, sw, sh, 0, 0, w, h);

        ctxNSR.fillStyle = "rgba(0,0,0,0.35)";
        ctxNSR.fillRect(0, h-100, w, 100);

        const barBase = h;
        const barMaxH = 100;
        const lonRange = NSR_RECT.lonMax - NSR_RECT.lonMin;
        const barW = Math.max(1, (1 * Math.PI / 180) / lonRange * w);

        for (let i=0; i<revisitGrid.length; i++) {

            const node = revisitGrid[i];
            const dt = simTime - lastSeen[i];
            const remain = Math.max(0, ALLOW_TIME - dt);

            const frac = Math.min(1, remain / ALLOW_TIME);
            const bh = frac * barMaxH;

            const hours = dt / 3600;

            if (hours > 4) ctxNSR.fillStyle = "red";
            else if (hours > 2) ctxNSR.fillStyle = "yellow";
            else ctxNSR.fillStyle = "limegreen";

            const xPos = (node.lon - NSR_RECT.lonMin) / lonRange * w;
            ctxNSR.fillRect(xPos, barBase - bh, barW, bh);
        }

        // ---------- макс. время пролёта ----------
        if (maxRevisitTime > 0) {
            const totalMin = Math.round(maxRevisitTime / 60);
            const hh = Math.floor(totalMin / 60);
            const mm = totalMin % 60;
            const label = `макс. время без покрытия: ${hh}ч ${mm.toString().padStart(2,"0")}м`;
            ctxNSR.font = "bold 13px monospace";
            const tw = ctxNSR.measureText(label).width;
            ctxNSR.fillStyle = "rgba(0,0,0,0.55)";
            ctxNSR.fillRect(w - tw - 16, 6, tw + 12, 22);
            ctxNSR.fillStyle = "#ffffff";
            ctxNSR.fillText(label, w - tw - 10, 22);
        }
    }

    // ---------- рисуем зоны обзора ----------
    activeSats.forEach(sat => {

        if (!sat.coverageMesh) return;
        if (!sat.coverageMesh._coveragePoints) return;

        const pts = sat.coverageMesh._coveragePoints;
        if (pts.length < 3) return;

        ctxNSR.beginPath();
        ctxNSR.strokeStyle = "rgba(220,0,0,0.55)";
        ctxNSR.fillStyle = "rgba(220,0,0,0.12)";
        ctxNSR.lineWidth = 1.0;

        let started = false;

        let prevLon = null;

        const projPts = [];

        pts.forEach(p => {

            const r = [
                p.x * CONST.R_EARTH,
                -p.z * CONST.R_EARTH,
                p.y * CONST.R_EARTH
            ];

            const geo = xyzToLatLon(r, simTime);
            const pt = latLonToXY_NSR(geo.lat, geo.lon, w, h);

            if (pt) projPts.push(pt);
        });

        if (projPts.length < 3) return;

// ---- центр полигона ----
        let cx = 0, cy = 0;
        projPts.forEach(pt => {
            cx += pt.x;
            cy += pt.y;
        });
        cx /= projPts.length;
        cy /= projPts.length;

// ---- сортировка по углу ----
        projPts.sort((a, b) => {
            const aa = Math.atan2(a.y - cy, a.x - cx);
            const bb = Math.atan2(b.y - cy, b.x - cx);
            return aa - bb;
        });

// ---- рисование ----
        ctxNSR.beginPath();
        ctxNSR.strokeStyle = "rgba(220,0,0,0.55)";
        ctxNSR.fillStyle = "rgba(220,0,0,0.12)";
        ctxNSR.lineWidth = 1.0;

        ctxNSR.moveTo(projPts[0].x, projPts[0].y);

        for (let k = 1; k < projPts.length; k++) {
            ctxNSR.lineTo(projPts[k].x, projPts[k].y);
        }

        ctxNSR.closePath();
        ctxNSR.fill();
        ctxNSR.stroke();

        if (started) {
            ctxNSR.closePath();
            ctxNSR.fill();
            ctxNSR.stroke();
        }
    });
}

canvas2d.addEventListener("mousemove", (e) => {

    const rect = canvas2d.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lon = (x / canvas2d.width) * 2 * Math.PI - Math.PI;
    const lat = Math.PI / 2 - (y / canvas2d.height) * Math.PI;

    document.getElementById("coordLabel").innerText =
        `lat ${(lat * 180 / Math.PI).toFixed(1)}°, lon ${(lon * 180 / Math.PI).toFixed(1)}°`;
});

function resize2D() {
    canvas2d.width = container2d.clientWidth;
    canvas2d.height = container2d.clientHeight;
}

setTimeout(resize2D, 100);
window.addEventListener("resize", resize2D);

const worldMapImg = new Image();
worldMapImg.src = "worldmap.jpg";

function drawMapBackground(w, h) {
    if (worldMapImg.complete && worldMapImg.naturalWidth > 0) {
        ctx.drawImage(worldMapImg, 0, 0, w, h);
    } else {
        ctx.fillStyle = "#0a1a2e";
        ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 0.5;
    for (let k = 0; k <= 6; k++) {
        const x = k * w / 6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
    for (let k = 0; k <= 4; k++) {
        const y = k * h / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
}

function xyzToLatLon(r, t) {
    const rn = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);

    let lon = Math.atan2(r[1], r[0]) - CONST.OMEGA_EARTH * t;

    while (lon > Math.PI) lon -= 2 * Math.PI;
    while (lon < -Math.PI) lon += 2 * Math.PI;

    return {
        lat: Math.asin(r[2] / rn),
        lon: lon
    };
}

function xyzToLatLon(r, t) {
    const rn = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);

    let lon = Math.atan2(r[1], r[0]) - CONST.OMEGA_EARTH * t;

    while (lon > Math.PI) lon -= 2 * Math.PI;
    while (lon < -Math.PI) lon += 2 * Math.PI;

    return {
        lat: Math.asin(r[2] / rn),
        lon: lon
    };
}

function latLonToXY(lat, lon, w, h) {
    return {
        x: (lon + Math.PI) / (2 * Math.PI) * w,
        y: (Math.PI / 2 - lat) / Math.PI * h
    };
}

function unwrapLongitude(prevLon, lon) {

    while (lon - prevLon > Math.PI) lon -= 2 * Math.PI;
    while (lon - prevLon < -Math.PI) lon += 2 * Math.PI;

    return lon;
}

// =====================
// СЕВЕРНЫЙ МОРСКОЙ ПУТЬ
// =====================
const NSR_WAYPOINTS = [
    {name: "Мурманск", lat: 68.97, lon: 33.08},
    {name: "Архангельск", lat: 64.54, lon: 40.52},
    {name: "Карские ворота", lat: 70.30, lon: 57.70},
    {name: "Диксон", lat: 73.51, lon: 80.55},
    {name: "Дудинка", lat: 69.39, lon: 86.18},
    {name: "Хатанга", lat: 71.98, lon: 102.45},
    {name: "Тикси", lat: 71.64, lon: 128.87},
    {name: "Певек", lat: 69.70, lon: 170.27},
    {name: "Берингов пролив", lat: 65.80, lon: -168.90},
].map(p => ({name: p.name, lat: p.lat * Math.PI / 180, lon: p.lon * Math.PI / 180}));

function drawNSR(w, h) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#ff6600";
    ctx.fillStyle = "#ff6600";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);

    // Линия маршрута; разрыв на антимеридиане
    ctx.beginPath();
    let prevLon = null;
    NSR_WAYPOINTS.forEach(p => {
        const {x, y} = latLonToXY(p.lat, p.lon, w, h);
        if (prevLon !== null && Math.abs(p.lon - prevLon) > Math.PI) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y);
        } else if (prevLon === null) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        prevLon = p.lon;
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Точки и подписи
    ctx.font = "9px monospace";
    NSR_WAYPOINTS.forEach(p => {
        const {x, y} = latLonToXY(p.lat, p.lon, w, h);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillText(p.name, x + 5, y - 3);
    });
    ctx.restore();
}

function update2D() {
    const w = canvas2d.width, h = canvas2d.height;
    ctx.clearRect(0, 0, w, h);
    drawMapBackground(w, h);
    // drawNSR(w, h);

    activeSats.forEach(sat => {
        const css = "#" + sat.color.getHexString();
        ctx.strokeStyle = css;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();

        let penDown = false, prevLon = null;
        sat.trail.forEach(({r, t}) => {
            const {lat, lon} = xyzToLatLon(r, t);
            const {x, y} = latLonToXY(lat, lon, w, h);
            if (penDown && Math.abs(lon - prevLon) > Math.PI) {
                ctx.stroke();
                ctx.beginPath();
                penDown = false;
            }
            penDown ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            penDown = true;
            prevLon = lon;
        });
        ctx.stroke();

        const cur = sat.trail[sat.trail.length - 1];
        if (cur) {
            const {lat, lon} = xyzToLatLon(cur.r, cur.t);
            const {x, y} = latLonToXY(lat, lon, w, h);
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = css;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.fill();
        }
    });

    // Покрытие — прямоугольная полоса
    activeSats.forEach(sat => {
        if (!sat.coverageMesh._coveragePoints) return;
        const cur = sat.trail[sat.trail.length - 1];
        if (!cur) return;

        const css = "#" + sat.color.getHexString();

        // Опорная долгота спутника — нормализуем остальные точки относительно неё,
        // чтобы прямоугольник не разрывался на антимеридиане
        const {lon: refLon} = xyzToLatLon(cur.r, cur.t);

        const mapPts = sat.coverageMesh._coveragePoints.map(p => {
            const r = [
                p.x * CONST.R_EARTH,
                -p.z * CONST.R_EARTH,
                p.y * CONST.R_EARTH
            ];
            const {lat, lon: rawLon} = xyzToLatLon(r, simTime);
            let d = rawLon - refLon;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            return latLonToXY(lat, refLon + d, w, h);
        });

        ctx.beginPath();
        ctx.moveTo(mapPts[0].x, mapPts[0].y);
        for (let k = 1; k < mapPts.length; k++) ctx.lineTo(mapPts[k].x, mapPts[k].y);
        ctx.closePath();

        ctx.globalAlpha = 0.15;
        ctx.fillStyle = css;
        ctx.fill();

        ctx.globalAlpha = 0.65;
        ctx.strokeStyle = css;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });

    ctx.globalAlpha = 1.0;
}

// =====================
// ГЛАВНЫЙ LOOP
// =====================
function animate() {
    requestAnimationFrame(animate);

    simSpeed = parseFloat(document.getElementById("speed").value);
    const stepsPerFrame = Math.max(1, Math.floor(simSpeed));

    for (let k = 0; k < stepsPerFrame; k++) {
        update3D();
        simTime += CONST.DT;
        earth.rotation.y += CONST.OMEGA_EARTH * CONST.DT;
    }

    updateRevisitGrid();
    update2D();
    updateNSRMap();
    orbitControls.update();
    renderer.render(scene, camera);
    document.getElementById("timeLabel").innerText = `${simTime.toFixed(0)} s`;
}

animate();
