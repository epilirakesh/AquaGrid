from datetime import date
from typing import Optional

from pydantic import BaseModel


class EnvironmentData(BaseModel):
    sst_c: Optional[float] = None
    current_u_ms: Optional[float] = None
    current_v_ms: Optional[float] = None
    current_speed_ms: Optional[float] = None
    salinity_psu: Optional[float] = None
    mixed_layer_m: Optional[float] = None
    ssh_m: Optional[float] = None
    chlorophyll_mg_m3: Optional[float] = None


class PFZResponse(BaseModel):
    date: date
    source: str
    h3_index: str

    latitude: float
    longitude: float

    probability: Optional[float] = None
    confidence: Optional[str] = None
    prediction: Optional[int] = None

    observed_pfz: Optional[bool] = None
    replay_score: Optional[float] = None
    replay_confidence: Optional[str] = None
    environment: Optional[EnvironmentData] = None