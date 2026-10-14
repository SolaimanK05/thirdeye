from typing import Annotated

from fastapi import Depends, Request

from thirdeye.db import Conn
from thirdeye.layers import LayerCache
from thirdeye.reads import DbReader, Reader
from thirdeye.registry import Module


def get_reader(conn: Conn) -> Reader:
    return DbReader(conn)


def get_layer_cache(request: Request) -> LayerCache:
    cache: LayerCache = request.app.state.layer_cache
    return cache


def get_enabled(request: Request) -> dict[str, Module]:
    modules: dict[str, Module] = request.app.state.enabled_modules
    return modules


ReaderDep = Annotated[Reader, Depends(get_reader)]
LayerCacheDep = Annotated[LayerCache, Depends(get_layer_cache)]
EnabledDep = Annotated[dict[str, Module], Depends(get_enabled)]
