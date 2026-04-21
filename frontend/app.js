// =====================
// КОНСТАНТЫ
// =====================
const CONST = {
    R_EARTH:     6378137,
    SCALE:       1 / 6378137,
    SAT_SIZE:    0.022,
    OMEGA_EARTH: 7.2921159e-5,
    DT:          10,
    SIM_SPEED:   1.0
};

const TRAIL_LEN  = 900;   // ~1.7 витка при 400 км
const PREFETCH   = 200;   // запрашиваем продолжение за 200 шагов до конца

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

const renderer = new THREE.WebGLRenderer({ antialias: true });
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
        new THREE.Vector3(0,  1.6, 0)
    ]),
    new THREE.LineBasicMaterial({ color: 0xffcc00 })
));

// =====================
// ВСПОМОГАТЕЛЬНОЕ
// =====================
function eciToThree(r) {
    return new THREE.Vector3(r[0]*CONST.SCALE, r[2]*CONST.SCALE, -r[1]*CONST.SCALE);
}

function planeColor(planeIdx, nPlanes) {
    const c = new THREE.Color();
    c.setHSL(planeIdx / nPlanes, 0.9, 0.55);
    return c;
}

function updateCoverageMesh(mesh, satPos) {
const theta = parseFloat(document.getElementById("fov").value) * Math.PI/180;

    const r_s = satPos.length(); // в нормированных единицах (R=1)
    const R   = 1.0;

    // геометрия конуса от надира
    let psi = Math.asin(Math.min(1, (r_s / R) * Math.sin(theta)));

    // ограничение горизонтом
    const psi_max = Math.acos(R / r_s);
    psi = Math.min(psi, psi_max);

    const n = satPos.clone().normalize();
    let u = new THREE.Vector3(0, 1, 0).cross(n);
    if (u.length() < 1e-6) u = new THREE.Vector3(1, 0, 0);
    u.normalize();
    const v = n.clone().cross(u);
    const pts = [];
    for (let k = 0; k < 64; k++) {
        const phi = 2 * Math.PI * k / 64;
        pts.push(
            n.clone().multiplyScalar(Math.cos(psi))
             .add(u.clone().multiplyScalar(Math.sin(psi) * Math.cos(phi)))
             .add(v.clone().multiplyScalar(Math.sin(psi) * Math.sin(phi)))
             .normalize()
        );
    }
    mesh.geometry.setFromPoints(pts);
    mesh._coveragePoints = pts;
}

// =====================
// СОСТОЯНИЕ
// =====================
let simTime   = 0;
let activeSats  = [];
let planeRings  = [];
let simSpeed = 1.0;

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ satellites })
    })
    .then(r => r.json())
    .then(data => {
        data.trajectories.forEach(({ positions, final_v }, idx) => {
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

    const params = getParams();
    const { planes, spp } = params;
    const constellation = generateConstellation(planes, spp);

    fetch("http://127.0.0.1:8000/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            a: params.a, e: params.e, i: params.i,
            satellites: constellation.map(s => ({ raan: s.raan, nu: s.nu }))
        })
    })
    .then(r => r.json())
    .then(data => {
        // Кольца орбитальных плоскостей — из бэкенда
        (data.rings || []).forEach((ringPts, p) => {
            const color = planeColor(p, planes);
            const pts   = ringPts.map(r => eciToThree(r));
            const ring  = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 })
            );
            scene.add(ring);
            planeRings.push(ring);
        });

        // Спутники
        data.trajectories.forEach(({ positions, final_v }, idx) => {
            const { planeIdx } = constellation[idx];
            const color = planeColor(planeIdx, planes);

            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(CONST.SAT_SIZE, 8, 8),
                new THREE.MeshBasicMaterial({ color })
            );
            scene.add(mesh);

            const trailBuf = new Float32Array(TRAIL_LEN * 3);
            const trailGeo = new THREE.BufferGeometry();
            trailGeo.setAttribute("position", new THREE.BufferAttribute(trailBuf, 3));
            trailGeo.setDrawRange(0, 0);
            const trailLine = new THREE.Line(
                trailGeo,
                new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })
            );
            scene.add(trailLine);

            const coverageMesh = new THREE.LineLoop(
                new THREE.BufferGeometry(),
                new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
            );
            scene.add(coverageMesh);

            activeSats.push({
                buffer:   positions,        // скользящий буфер позиций с бэкенда
                bufStep:  0,                // текущий шаг в buffer
                lastR:    positions[positions.length - 1],
                lastV:    final_v,
                fetching: false,
                trail:    [],
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
        sat.bufStep++;

        // Сдвигаем окно буфера чтобы не копить память
        if (sat.bufStep > 4000) {
            sat.buffer.splice(0, sat.bufStep);
            sat.bufStep = 0;
        }

        // Трек
        sat.trail.push({ r, t: simTime });
        if (sat.trail.length > TRAIL_LEN) sat.trail.shift();

        // Меш спутника
        const pos3 = eciToThree(r);
        sat.mesh.position.copy(pos3);

        // Буфер трека
        const buf = sat.trailLine.geometry.attributes.position.array;
        sat.trail.forEach(({ r: tr }, j) => {
            buf[j*3]   =  tr[0] * CONST.SCALE;
            buf[j*3+1] =  tr[2] * CONST.SCALE;
            buf[j*3+2] = -tr[1] * CONST.SCALE;
        });
        sat.trailLine.geometry.attributes.position.needsUpdate = true;
        sat.trailLine.geometry.setDrawRange(0, sat.trail.length);

        updateCoverageMesh(sat.coverageMesh, pos3);
    });
}

// =====================
// 2D КАРТА
// =====================
const container2d = document.getElementById("top2d");
const canvas2d    = document.createElement("canvas");
canvas2d.style.display = "block";
container2d.appendChild(canvas2d);
const ctx = canvas2d.getContext("2d");

canvas2d.addEventListener("mousemove", (e) => {

    const rect = canvas2d.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lon = (x / canvas2d.width) * 2*Math.PI - Math.PI;
    const lat = Math.PI/2 - (y / canvas2d.height) * Math.PI;

    document.getElementById("coordLabel").innerText =
        `lat ${(lat*180/Math.PI).toFixed(1)}°, lon ${(lon*180/Math.PI).toFixed(1)}°`;
});

function resize2D() {
    canvas2d.width  = container2d.clientWidth;
    canvas2d.height = container2d.clientHeight;
}
resize2D();
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
    ctx.lineWidth   = 0.5;
    for (let k = 0; k <= 6; k++) {
        const x = k * w / 6;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let k = 0; k <= 4; k++) {
        const y = k * h / 4;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
}

function xyzToLatLon(r, t) {
    const rn = Math.sqrt(r[0]*r[0] + r[1]*r[1] + r[2]*r[2]);
    return {
        lat: Math.asin(r[2] / rn),
        lon: Math.atan2(r[1], r[0]) - CONST.OMEGA_EARTH * t
    };
}

function latLonToXY(lat, lon, w, h) {
    return {
        x: (lon + Math.PI) / (2 * Math.PI) * w,
        y: (Math.PI / 2 - lat) / Math.PI * h
    };
}

function update2D() {
    const w = canvas2d.width, h = canvas2d.height;
    ctx.clearRect(0, 0, w, h);
    drawMapBackground(w, h);

    activeSats.forEach(sat => {
        const css = "#" + sat.color.getHexString();
        ctx.strokeStyle = css;
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();

        let penDown = false, prevLon = null;
        sat.trail.forEach(({ r, t }) => {
            const { lat, lon } = xyzToLatLon(r, t);
            const { x, y }    = latLonToXY(lat, lon, w, h);
            if (penDown && Math.abs(lon - prevLon) > Math.PI) {
                ctx.stroke(); ctx.beginPath(); penDown = false;
            }
            penDown ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            penDown = true; prevLon = lon;
        });
        ctx.stroke();

        const cur = sat.trail[sat.trail.length - 1];
        if (cur) {
            const { lat, lon } = xyzToLatLon(cur.r, cur.t);
            const { x, y }     = latLonToXY(lat, lon, w, h);
            ctx.globalAlpha = 1.0;
            ctx.fillStyle   = css;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.fill();
        }
    });

    activeSats.forEach(sat => {

    if (!sat.coverageMesh._coveragePoints) return;

    const css = "#" + sat.color.getHexString();

    ctx.strokeStyle = css;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();

    let first = true;

    sat.coverageMesh._coveragePoints.forEach(p => {

        // обратно в ECI (учитываем масштаб)
        const r = [
            p.x * CONST.R_EARTH,
            -p.z * CONST.R_EARTH,
            p.y * CONST.R_EARTH
        ];

        const { lat, lon } = xyzToLatLon(r, simTime);

        const { x, y } = latLonToXY(lat, lon, w, h);

        if (first) {
            ctx.moveTo(x, y);
            first = false;
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.closePath();
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

    // сколько шагов проигрываем за кадр
    const stepsPerFrame = Math.max(1, Math.floor(simSpeed));

    for (let k = 0; k < stepsPerFrame; k++) {
        update3D();
        simTime += CONST.DT;
        earth.rotation.y += CONST.OMEGA_EARTH * CONST.DT;
    }

    // update3D();
    update2D();
    orbitControls.update();
    renderer.render(scene, camera);
    // simTime += CONST.DT;
    // earth.rotation.y += CONST.OMEGA_EARTH * CONST.DT;
    document.getElementById("timeLabel").innerText = `${simTime.toFixed(0)} s`;
}

animate();
