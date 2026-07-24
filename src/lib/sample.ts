/* Generated from live endpoints — see scenarios.ts. */
import type { GridResponse, CurtailmentResponse } from './types';

export const SAMPLE_GRID: GridResponse = {
  "fetchedAt": "2026-07-24T19:48:53.731Z",
  "settlement": {
    "date": "2026-07-24",
    "period": 42,
    "periodStart": "2026-07-24T19:30:00.000Z",
    "periodEnd": "2026-07-24T20:00:00.000Z"
  },
  "health": {
    "overall": "ok",
    "national": "ok",
    "regional": "ok",
    "forecast": "ok"
  },
  "errors": [],
  "national": {
    "intensity": {
      "forecast": 139,
      "actual": 149,
      "index": "moderate"
    },
    "generationMix": [
      {
        "fuel": "biomass",
        "perc": 9.3
      },
      {
        "fuel": "coal",
        "perc": 0
      },
      {
        "fuel": "imports",
        "perc": 13.4
      },
      {
        "fuel": "gas",
        "perc": 31.2
      },
      {
        "fuel": "nuclear",
        "perc": 12.4
      },
      {
        "fuel": "other",
        "perc": 0
      },
      {
        "fuel": "hydro",
        "perc": 0
      },
      {
        "fuel": "solar",
        "perc": 4.6
      },
      {
        "fuel": "wind",
        "perc": 29.1
      }
    ],
    "windPct": 29.1,
    "gasPct": 31.2
  },
  "regions": {
    "scotland": {
      "regionId": 16,
      "name": "Scotland",
      "intensity": {
        "forecast": 1,
        "actual": null,
        "index": "very low"
      },
      "generationMix": [
        {
          "fuel": "biomass",
          "perc": 0.9
        },
        {
          "fuel": "coal",
          "perc": 0
        },
        {
          "fuel": "imports",
          "perc": 0
        },
        {
          "fuel": "gas",
          "perc": 0
        },
        {
          "fuel": "nuclear",
          "perc": 22.8
        },
        {
          "fuel": "other",
          "perc": 0
        },
        {
          "fuel": "hydro",
          "perc": 0
        },
        {
          "fuel": "solar",
          "perc": 0.6
        },
        {
          "fuel": "wind",
          "perc": 75.7
        }
      ],
      "windPct": 75.7,
      "gasPct": 0
    },
    "northScotland": {
      "regionId": 1,
      "name": "North Scotland",
      "intensity": {
        "forecast": 0,
        "actual": null,
        "index": "very low"
      },
      "generationMix": [
        {
          "fuel": "biomass",
          "perc": 0
        },
        {
          "fuel": "coal",
          "perc": 0
        },
        {
          "fuel": "imports",
          "perc": 0
        },
        {
          "fuel": "gas",
          "perc": 0
        },
        {
          "fuel": "nuclear",
          "perc": 0
        },
        {
          "fuel": "other",
          "perc": 0
        },
        {
          "fuel": "hydro",
          "perc": 0
        },
        {
          "fuel": "solar",
          "perc": 0.7
        },
        {
          "fuel": "wind",
          "perc": 99.3
        }
      ],
      "windPct": 99.3,
      "gasPct": 0
    },
    "southScotland": {
      "regionId": 2,
      "name": "South Scotland",
      "intensity": {
        "forecast": 1,
        "actual": null,
        "index": "very low"
      },
      "generationMix": [
        {
          "fuel": "biomass",
          "perc": 1
        },
        {
          "fuel": "coal",
          "perc": 0
        },
        {
          "fuel": "imports",
          "perc": 0
        },
        {
          "fuel": "gas",
          "perc": 0
        },
        {
          "fuel": "nuclear",
          "perc": 24.7
        },
        {
          "fuel": "other",
          "perc": 0
        },
        {
          "fuel": "hydro",
          "perc": 0
        },
        {
          "fuel": "solar",
          "perc": 0.7
        },
        {
          "fuel": "wind",
          "perc": 73.6
        }
      ],
      "windPct": 73.6,
      "gasPct": 0
    },
    "southEngland": {
      "regionId": 12,
      "name": "South England",
      "intensity": {
        "forecast": 206,
        "actual": null,
        "index": "high"
      },
      "generationMix": [
        {
          "fuel": "biomass",
          "perc": 7.6
        },
        {
          "fuel": "coal",
          "perc": 0
        },
        {
          "fuel": "imports",
          "perc": 9.8
        },
        {
          "fuel": "gas",
          "perc": 49.1
        },
        {
          "fuel": "nuclear",
          "perc": 8.8
        },
        {
          "fuel": "other",
          "perc": 0
        },
        {
          "fuel": "hydro",
          "perc": 0
        },
        {
          "fuel": "solar",
          "perc": 7.6
        },
        {
          "fuel": "wind",
          "perc": 17.2
        }
      ],
      "windPct": 17.2,
      "gasPct": 49.1
    },
    "southEastEngland": {
      "regionId": 14,
      "name": "South East England",
      "intensity": {
        "forecast": 118,
        "actual": null,
        "index": "moderate"
      },
      "generationMix": [
        {
          "fuel": "biomass",
          "perc": 0
        },
        {
          "fuel": "coal",
          "perc": 0
        },
        {
          "fuel": "imports",
          "perc": 70.5
        },
        {
          "fuel": "gas",
          "perc": 20.6
        },
        {
          "fuel": "nuclear",
          "perc": 0
        },
        {
          "fuel": "other",
          "perc": 0
        },
        {
          "fuel": "hydro",
          "perc": 0.5
        },
        {
          "fuel": "solar",
          "perc": 1.5
        },
        {
          "fuel": "wind",
          "perc": 6.9
        }
      ],
      "windPct": 6.9,
      "gasPct": 20.6
    }
  },
  "forecast": [
    {
      "from": "2026-07-24T19:30Z",
      "to": "2026-07-24T20:00Z",
      "forecast": 143,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T20:00Z",
      "to": "2026-07-24T20:30Z",
      "forecast": 142,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T20:30Z",
      "to": "2026-07-24T21:00Z",
      "forecast": 142,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T21:00Z",
      "to": "2026-07-24T21:30Z",
      "forecast": 134,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T21:30Z",
      "to": "2026-07-24T22:00Z",
      "forecast": 127,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T22:00Z",
      "to": "2026-07-24T22:30Z",
      "forecast": 118,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T22:30Z",
      "to": "2026-07-24T23:00Z",
      "forecast": 110,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T23:00Z",
      "to": "2026-07-24T23:30Z",
      "forecast": 104,
      "index": "moderate"
    },
    {
      "from": "2026-07-24T23:30Z",
      "to": "2026-07-25T00:00Z",
      "forecast": 102,
      "index": "moderate"
    },
    {
      "from": "2026-07-25T00:00Z",
      "to": "2026-07-25T00:30Z",
      "forecast": 90,
      "index": "moderate"
    },
    {
      "from": "2026-07-25T00:30Z",
      "to": "2026-07-25T01:00Z",
      "forecast": 82,
      "index": "low"
    },
    {
      "from": "2026-07-25T01:00Z",
      "to": "2026-07-25T01:30Z",
      "forecast": 78,
      "index": "low"
    },
    {
      "from": "2026-07-25T01:30Z",
      "to": "2026-07-25T02:00Z",
      "forecast": 85,
      "index": "low"
    },
    {
      "from": "2026-07-25T02:00Z",
      "to": "2026-07-25T02:30Z",
      "forecast": 82,
      "index": "low"
    },
    {
      "from": "2026-07-25T02:30Z",
      "to": "2026-07-25T03:00Z",
      "forecast": 83,
      "index": "low"
    },
    {
      "from": "2026-07-25T03:00Z",
      "to": "2026-07-25T03:30Z",
      "forecast": 81,
      "index": "low"
    },
    {
      "from": "2026-07-25T03:30Z",
      "to": "2026-07-25T04:00Z",
      "forecast": 78,
      "index": "low"
    },
    {
      "from": "2026-07-25T04:00Z",
      "to": "2026-07-25T04:30Z",
      "forecast": 82,
      "index": "low"
    },
    {
      "from": "2026-07-25T04:30Z",
      "to": "2026-07-25T05:00Z",
      "forecast": 82,
      "index": "low"
    },
    {
      "from": "2026-07-25T05:00Z",
      "to": "2026-07-25T05:30Z",
      "forecast": 84,
      "index": "low"
    },
    {
      "from": "2026-07-25T05:30Z",
      "to": "2026-07-25T06:00Z",
      "forecast": 77,
      "index": "low"
    },
    {
      "from": "2026-07-25T06:00Z",
      "to": "2026-07-25T06:30Z",
      "forecast": 72,
      "index": "low"
    },
    {
      "from": "2026-07-25T06:30Z",
      "to": "2026-07-25T07:00Z",
      "forecast": 71,
      "index": "low"
    },
    {
      "from": "2026-07-25T07:00Z",
      "to": "2026-07-25T07:30Z",
      "forecast": 63,
      "index": "low"
    },
    {
      "from": "2026-07-25T07:30Z",
      "to": "2026-07-25T08:00Z",
      "forecast": 55,
      "index": "low"
    },
    {
      "from": "2026-07-25T08:00Z",
      "to": "2026-07-25T08:30Z",
      "forecast": 51,
      "index": "low"
    },
    {
      "from": "2026-07-25T08:30Z",
      "to": "2026-07-25T09:00Z",
      "forecast": 45,
      "index": "low"
    },
    {
      "from": "2026-07-25T09:00Z",
      "to": "2026-07-25T09:30Z",
      "forecast": 42,
      "index": "low"
    },
    {
      "from": "2026-07-25T09:30Z",
      "to": "2026-07-25T10:00Z",
      "forecast": 40,
      "index": "low"
    },
    {
      "from": "2026-07-25T10:00Z",
      "to": "2026-07-25T10:30Z",
      "forecast": 40,
      "index": "low"
    },
    {
      "from": "2026-07-25T10:30Z",
      "to": "2026-07-25T11:00Z",
      "forecast": 38,
      "index": "low"
    },
    {
      "from": "2026-07-25T11:00Z",
      "to": "2026-07-25T11:30Z",
      "forecast": 32,
      "index": "low"
    },
    {
      "from": "2026-07-25T11:30Z",
      "to": "2026-07-25T12:00Z",
      "forecast": 32,
      "index": "low"
    },
    {
      "from": "2026-07-25T12:00Z",
      "to": "2026-07-25T12:30Z",
      "forecast": 31,
      "index": "low"
    },
    {
      "from": "2026-07-25T12:30Z",
      "to": "2026-07-25T13:00Z",
      "forecast": 31,
      "index": "low"
    },
    {
      "from": "2026-07-25T13:00Z",
      "to": "2026-07-25T13:30Z",
      "forecast": 32,
      "index": "low"
    },
    {
      "from": "2026-07-25T13:30Z",
      "to": "2026-07-25T14:00Z",
      "forecast": 30,
      "index": "low"
    },
    {
      "from": "2026-07-25T14:00Z",
      "to": "2026-07-25T14:30Z",
      "forecast": 29,
      "index": "low"
    },
    {
      "from": "2026-07-25T14:30Z",
      "to": "2026-07-25T15:00Z",
      "forecast": 31,
      "index": "low"
    },
    {
      "from": "2026-07-25T15:00Z",
      "to": "2026-07-25T15:30Z",
      "forecast": 29,
      "index": "low"
    },
    {
      "from": "2026-07-25T15:30Z",
      "to": "2026-07-25T16:00Z",
      "forecast": 32,
      "index": "low"
    },
    {
      "from": "2026-07-25T16:00Z",
      "to": "2026-07-25T16:30Z",
      "forecast": 37,
      "index": "low"
    },
    {
      "from": "2026-07-25T16:30Z",
      "to": "2026-07-25T17:00Z",
      "forecast": 47,
      "index": "low"
    },
    {
      "from": "2026-07-25T17:00Z",
      "to": "2026-07-25T17:30Z",
      "forecast": 54,
      "index": "low"
    },
    {
      "from": "2026-07-25T17:30Z",
      "to": "2026-07-25T18:00Z",
      "forecast": 62,
      "index": "low"
    },
    {
      "from": "2026-07-25T18:00Z",
      "to": "2026-07-25T18:30Z",
      "forecast": 72,
      "index": "low"
    },
    {
      "from": "2026-07-25T18:30Z",
      "to": "2026-07-25T19:00Z",
      "forecast": 82,
      "index": "low"
    },
    {
      "from": "2026-07-25T19:00Z",
      "to": "2026-07-25T19:30Z",
      "forecast": 88,
      "index": "low"
    }
  ]
};

export const SAMPLE_CURTAILMENT: CurtailmentResponse = {
  "fetchedAt": "2026-07-24T19:48:52.905Z",
  "health": {
    "overall": "ok",
    "now": "ok",
    "settled": "ok"
  },
  "errors": [],
  "now": {
    "settlement": {
      "date": "2026-07-24",
      "period": 42,
      "periodStart": "2026-07-24T19:30:00.000Z",
      "periodEnd": "2026-07-24T20:00:00.000Z"
    },
    "sampledAt": "2026-07-24T19:48:52.654Z",
    "curtailedMW": 1841,
    "unitsCurtailed": 15,
    "units": [
      {
        "id": "SGRWO-6",
        "name": "Seagreen 6",
        "farm": "Seagreen",
        "capacityMW": 525,
        "curtailedMW": 316
      },
      {
        "id": "MOWEO-1",
        "name": "Moray East 1",
        "farm": "Moray East",
        "capacityMW": 300,
        "curtailedMW": 213
      },
      {
        "id": "MOWWO-4",
        "name": "Moray West 4",
        "farm": "Moray West",
        "capacityMW": 287,
        "curtailedMW": 203
      },
      {
        "id": "MOWEO-2",
        "name": "Moray East 2",
        "farm": "Moray East",
        "capacityMW": 300,
        "curtailedMW": 165
      },
      {
        "id": "MOWWO-1",
        "name": "Moray West 1",
        "farm": "Moray West",
        "capacityMW": 215,
        "curtailedMW": 160
      },
      {
        "id": "SGRWO-3",
        "name": "Seagreen 3",
        "farm": "Seagreen",
        "capacityMW": 375,
        "curtailedMW": 134
      },
      {
        "id": "SGRWO-4",
        "name": "Seagreen 4",
        "farm": "Seagreen",
        "capacityMW": 140,
        "curtailedMW": 113
      },
      {
        "id": "MOWWO-2",
        "name": "Moray West 2",
        "farm": "Moray West",
        "capacityMW": 215,
        "curtailedMW": 111
      },
      {
        "id": "BEATO-4",
        "name": "Beatrice 4",
        "farm": "Beatrice",
        "capacityMW": 165.5,
        "curtailedMW": 105
      },
      {
        "id": "MOWWO-3",
        "name": "Moray West 3",
        "farm": "Moray West",
        "capacityMW": 143,
        "curtailedMW": 103
      },
      {
        "id": "SGRWO-5",
        "name": "Seagreen 5",
        "farm": "Seagreen",
        "capacityMW": 300,
        "curtailedMW": 68
      },
      {
        "id": "BEATO-2",
        "name": "Beatrice 2",
        "farm": "Beatrice",
        "capacityMW": 166,
        "curtailedMW": 63
      }
    ]
  },
  "settled": {
    "settlement": {
      "date": "2026-07-24",
      "period": 41,
      "periodStart": "2026-07-24T19:00:00.000Z",
      "periodEnd": "2026-07-24T19:30:00.000Z"
    },
    "curtailedMWh": 970.1,
    "unitsCurtailed": 16,
    "farms": [
      {
        "farm": "Seagreen",
        "name": "Seagreen",
        "curtailedMWh": 316
      },
      {
        "farm": "Moray West",
        "name": "Moray West",
        "curtailedMWh": 280
      },
      {
        "farm": "Moray East",
        "name": "Moray East",
        "curtailedMWh": 203
      },
      {
        "farm": "Beatrice",
        "name": "Beatrice",
        "curtailedMWh": 155.8
      },
      {
        "farm": "Gordonbush",
        "name": "Gordonbush",
        "curtailedMWh": 9
      },
      {
        "farm": "Edinbane",
        "name": "Edinbane",
        "curtailedMWh": 6.3
      }
    ]
  },
  "method": {
    "basis": "Instructed turn-downs of transmission-connected Scottish wind via the balancing mechanism: declared output (PN) minus accepted level (BOALF). Excludes self-curtailment, pre-adjusted declarations and distribution-connected units, so the figure is a floor.",
    "unitsTracked": 50,
    "capacityMW": 8573.9
  }
};
