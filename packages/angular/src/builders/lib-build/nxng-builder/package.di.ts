/**
 * Adapted from the original ng-packagr src.
 * Wires everything together and provides it to the DI, but exchanges the parts
 * we want to implement with Nx specific functions
 */

import { InjectionToken, Provider } from 'injection-js';
import { Transform } from 'ng-packagr/lib/graph/transform';
import {
  provideTransform,
  TransformProvider,
} from 'ng-packagr/lib/graph/transform.di';
import { PROJECT_TOKEN } from 'ng-packagr/lib/project.di';
import {
  DEFAULT_OPTIONS_PROVIDER,
  OPTIONS_TOKEN,
} from 'ng-packagr/lib/ng-package/options.di';
import {
  DEFAULT_TS_CONFIG_PROVIDER,
  INIT_TS_CONFIG_TOKEN,
} from 'ng-packagr/lib/ng-package/entry-point/init-tsconfig.di';
import {
  ANALYSE_SOURCES_TOKEN,
  ANALYSE_SOURCES_TRANSFORM,
} from 'ng-packagr/lib/ng-package/entry-point/analyse-sources.di';
import { NX_INIT_TS_CONFIG_TRANSFORM } from '@nrwl/angular/src/builders/lib-build/nxng-builder/init-tsconfig';
import { nxPackageTransformFactory } from '@nrwl/angular/src/builders/lib-build/nxng-builder/package';
import { NX_ENTRY_POINT_TRANSFORM_TOKEN } from '@nrwl/angular/src/builders/lib-build/nxng-builder/entry-point.di';

export const PACKAGE_TRANSFORM_TOKEN = new InjectionToken<Transform>(
  `nx.v1.packageTransform`
);

export const NX_PACKAGE_TRANSFORM: TransformProvider = provideTransform({
  provide: PACKAGE_TRANSFORM_TOKEN,
  useFactory: nxPackageTransformFactory,
  deps: [
    PROJECT_TOKEN,
    OPTIONS_TOKEN,
    INIT_TS_CONFIG_TOKEN,
    ANALYSE_SOURCES_TOKEN,
    NX_ENTRY_POINT_TRANSFORM_TOKEN,
  ],
});

export const NX_PACKAGE_PROVIDERS: Provider[] = [
  NX_PACKAGE_TRANSFORM,
  DEFAULT_OPTIONS_PROVIDER,
  DEFAULT_TS_CONFIG_PROVIDER,
  NX_INIT_TS_CONFIG_TRANSFORM,
  ANALYSE_SOURCES_TRANSFORM,
];
