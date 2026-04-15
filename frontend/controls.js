function initControls() {

    function bind(id, formatter) {
        const el = document.getElementById(id);
        const out = document.getElementById(id + "Val");

        function update() {
            out.textContent = formatter(el.value);
        }

        el.addEventListener("input", update);
        update();
    }

    bind("alt", v => `${v} km`);
    bind("inc", v => `${v}°`);
    bind("ecc", v => parseFloat(v).toFixed(2));
    bind("n", v => v);
}

function getParams() {
    return {
        a: 6378137 + parseFloat(document.getElementById("alt").value) * 1000,
        e: parseFloat(document.getElementById("ecc").value),
        i: parseFloat(document.getElementById("inc").value) * Math.PI / 180,
        satellites: generateSatellites(parseInt(document.getElementById("n").value))
    };
}

function generateSatellites(n) {
    const sats = [];
    for (let k = 0; k < n; k++) {
        sats.push({
            raan: 2 * Math.PI * k / n,
            nu: 0
        });
    }
    return sats;
}

document.addEventListener("DOMContentLoaded", initControls);