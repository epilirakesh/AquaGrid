from datetime import date
from typing import Optional

from pydantic import BaseModel


class BiodiversityEnvironment(BaseModel):
    sst_c: Optional[float] = None
    chlorophyll_mg_m3: Optional[float] = None
    salinity_psu: Optional[float] = None


class BiodiversityResponse(BaseModel):
    date: date
    source: str

    h3_index: str

    latitude: float
    longitude: float

    observation_status: str

    occurrence_count: Optional[int] = None
    species_count: Optional[int] = None
    species_richness: Optional[int] = None
    shannon_index: Optional[float] = None

    elasmobranch_count: Optional[int] = None
    crustacean_count: Optional[int] = None

    shannon_observed: bool = False
    richness_observed: bool = False

    environment: Optional[BiodiversityEnvironment] = None