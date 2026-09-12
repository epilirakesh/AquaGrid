from fastapi import APIRouter

from app.services.timeline import get_timeline


router = APIRouter(
    prefix="/timeline",
    tags=["Timeline"],
)


@router.get("")
def timeline():
    """
    Return the complete AquaGrid supported date timeline.
    """

    return get_timeline()