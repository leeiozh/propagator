function initControls() {
    function bind(id) {
        const slider = document.getElementById(id);
        const span   = document.getElementById(id + "Val");

        const ni = document.createElement("input");
        ni.type      = "number";
        ni.min       = slider.min;
        ni.max       = slider.max;
        ni.step      = slider.step || "1";
        ni.className = "value num-input";
        span.replaceWith(ni);

        const fromSlider = () => { ni.value = parseFloat(slider.value); };

        const fromNum = () => {
            let v = parseFloat(ni.value);
            if (isNaN(v)) { fromSlider(); return; }
            v = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), v));
            ni.value    = v;
            slider.value = v;
            slider.dispatchEvent(new Event("input"));
        };

        slider.addEventListener("input", fromSlider);
        ni.addEventListener("change",  fromNum);
        ni.addEventListener("keydown", e => { if (e.key === "Enter") fromNum(); });
        fromSlider();
    }

    bind("sma");
    bind("inc");
    bind("ecc");
    bind("planes");
    bind("spp");
    bind("swath");
    bind("speed");

    function checkOrbit() {
        const a_km = parseFloat(document.getElementById("sma").value);
        const e    = parseFloat(document.getElementById("ecc").value);
        const h_km = a_km * (1 - e) - 6378.137;

        document.getElementById("periLabel").textContent = `Перигей: ${h_km.toFixed(0)} км`;
        document.getElementById("apoLabel").textContent  = `Апогей: ${(a_km * (1 + e) - 6378.137).toFixed(0)} км`;

        const warn = document.getElementById("orbitWarn");
        if (h_km < 0) {
            warn.className = "error";
            warn.textContent = "⚠ Перигей ниже поверхности Земли";
        } else if (h_km < 100) {
            warn.className = "warn";
            warn.textContent = "⚠ Перигей в атмосфере — орбита нестабильна";
        } else {
            warn.className = "";
            warn.textContent = "";
        }
    }

    ["sma", "ecc"].forEach(id =>
        document.getElementById(id).addEventListener("input", checkOrbit)
    );
    checkOrbit();
}

function getParams() {
    return {
        a:      parseFloat(document.getElementById("sma").value) * 1000,
        e:      parseFloat(document.getElementById("ecc").value),
        i:      parseFloat(document.getElementById("inc").value) * Math.PI / 180,
        planes: parseInt(document.getElementById("planes").value),
        spp:    parseInt(document.getElementById("spp").value),
        swath:  parseInt(document.getElementById("swath").value)
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