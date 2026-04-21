function initControls() {
    function bind(id, formatter) {
        const el = document.getElementById(id);
        const out = document.getElementById(id + "Val");
        const update = () => out.textContent = formatter(el.value);
        el.addEventListener("input", update);
        update();
    }
    bind("alt",    v => `${v} km`);
    bind("inc",    v => `${v}°`);
    bind("ecc",    v => parseFloat(v).toFixed(2));
    bind("planes", v => v);
    bind("spp",    v => v);
    bind("fov",    v => `${v}°`);
    bind("speed",  v => `${parseFloat(v).toFixed(1)}x`);
}

function getParams() {
    return {
        a:      6378137 + parseFloat(document.getElementById("alt").value) * 1000,
        e:      parseFloat(document.getElementById("ecc").value),
        i:      parseFloat(document.getElementById("inc").value) * Math.PI / 180,
        planes: parseInt(document.getElementById("planes").value),
        spp:    parseInt(document.getElementById("spp").value)
    };
}

// Walker T:P:1  (T = planes*spp, P = planes, F = 1)
function generateConstellation(planes, spp) {
    const sats = [];
    const T = planes * spp;
    for (let p = 0; p < planes; p++) {
        const raan = 2 * Math.PI * p / planes;
        for (let s = 0; s < spp; s++) {
            const nu = 2 * Math.PI * s / spp; // + 2 * Math.PI * p / T;
            sats.push({ raan, nu, planeIdx: p });
        }
    }
    return sats;
}

document.addEventListener("DOMContentLoaded", initControls);