import numpy as np


def generate_constellation(n_sat, n_planes):
    sats = []

    sats_per_plane = n_sat // n_planes

    for p in range(n_planes):
        raan = 2 * np.pi * p / n_planes

        for s in range(sats_per_plane):
            nu = 2 * np.pi * s / sats_per_plane

            sats.append({
                "raan": raan,
                "nu": nu
            })

    return sats
