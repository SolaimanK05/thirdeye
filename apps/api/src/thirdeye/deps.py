from collections.abc import Mapping
from typing import Annotated

from fastapi import Depends, Request

from thirdeye.config import Settings
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


def get_registry(request: Request) -> Mapping[str, Module]:
    registry: Mapping[str, Module] = request.app.state.registry
    return registry


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_default_on(request: Request) -> frozenset[str]:
    default_on: frozenset[str] = request.app.state.default_on
    return default_on


ReaderDep = Annotated[Reader, Depends(get_reader)]
LayerCacheDep = Annotated[LayerCache, Depends(get_layer_cache)]
EnabledDep = Annotated[dict[str, Module], Depends(get_enabled)]
RegistryDep = Annotated[Mapping[str, Module], Depends(get_registry)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
DefaultOnDep = Annotated[frozenset[str], Depends(get_default_on)]
