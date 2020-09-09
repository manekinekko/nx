import { InjectionToken, Provider } from 'injection-js';
import * as fs from 'fs-extra';
import {
  DEFAULT_OPTIONS_PROVIDER,
  NgPackagrOptions,
  OPTIONS_TOKEN,
} from 'ng-packagr/lib/ng-package/options.di';
import { Transform } from 'ng-packagr/lib/graph/transform';
import { from, Observable, pipe, of as observableOf, of } from 'rxjs';
import { BuildGraph } from 'ng-packagr/lib/graph/build-graph';
import {
  provideTransform,
  TransformProvider,
} from 'ng-packagr/lib/graph/transform.di';
import { PROJECT_TOKEN } from 'ng-packagr/lib/project.di';
import {
  DEFAULT_TS_CONFIG_PROVIDER,
  INIT_TS_CONFIG_TOKEN,
  INIT_TS_CONFIG_TRANSFORM,
} from 'ng-packagr/lib/ng-package/entry-point/init-tsconfig.di';
import {
  ANALYSE_SOURCES_TOKEN,
  ANALYSE_SOURCES_TRANSFORM,
} from 'ng-packagr/lib/ng-package/entry-point/analyse-sources.di';
import { ENTRY_POINT_TRANSFORM_TOKEN } from 'ng-packagr/lib/ng-package/entry-point/entry-point.di';
import {
  concatMap,
  defaultIfEmpty,
  filter,
  map,
  mapTo,
  switchMap,
  takeLast,
  tap,
} from 'rxjs/operators';
import { packageTransformFactory } from 'ng-packagr/lib/ng-package/package.transform';
import { NX_ENTRY_POINT_TRANSFORM_TOKEN } from './entry-point';
import * as log from 'ng-packagr/lib/utils/log';
import * as path from 'path';
import { discoverPackages } from './discover-packages';
import { rimraf } from 'ng-packagr/lib/utils/rimraf';
import {
  byEntryPoint,
  EntryPointNode,
  GlobCache,
  isEntryPoint,
  ngUrl,
  PackageNode,
} from 'ng-packagr/lib/ng-package/nodes';
import { DepthBuilder } from 'ng-packagr/lib/graph/depth';
import { flatten } from 'ng-packagr/lib/utils/array';
import { STATE_IN_PROGESS } from 'ng-packagr/lib/graph/node';
import { NX_INIT_TS_CONFIG_TRANSFORM } from './init-tsconfig';

export const nxPackageTransformFactory = (
  project: string,
  options: NgPackagrOptions,
  initTsConfigTransform: Transform,
  analyseSourcesTransform: Transform,
  entryPointTransform: Transform
) => (source$: Observable<BuildGraph>): Observable<BuildGraph> => {
  const pkgUri = ngUrl(project);

  const buildTransform = buildTransformFactory(
    project,
    analyseSourcesTransform,
    entryPointTransform
  );
  // let discoverPackagesStart;
  // let discoverPackagesTime;
  // let addEntryPointsStart;
  // let addEntryPoints;

  return source$.pipe(
    tap(() => {
      console.log('👋😎');
    }),
    tap(() => log.info(`Building Angular Package`)),
    // Discover packages and entry points
    // tap(() => (discoverPackagesStart = process.hrtime())),
    switchMap((graph) => {
      const pkg = discoverPackages(project);

      return from(pkg).pipe(
        map((value) => {
          const ngPkg = new PackageNode(pkgUri);
          ngPkg.data = value;

          return graph.put(ngPkg);
        })
      );
    }),
    // tap(() => {
    //   discoverPackagesTime = process.hrtime(discoverPackagesStart);
    //   console.log(`Discover packages: ${discoverPackagesTime}`);
    // }),
    // Clean the primary dest folder (should clean all secondary sub-directory, as well)
    switchMap((graph: BuildGraph) => {
      const { dest, deleteDestPath } = graph.get(pkgUri).data;
      return from(deleteDestPath ? rimraf(dest) : Promise.resolve()).pipe(
        map(() => graph)
      );
    }),
    // Add entry points to graph
    map((graph) => {
      // addEntryPointsStart = process.hrtime();

      const ngPkg = graph.get(pkgUri) as PackageNode;
      const entryPoints = [ngPkg.data.primary, ...ngPkg.data.secondaries].map(
        (entryPoint) => {
          const { destinationFiles, moduleId } = entryPoint;
          const node = new EntryPointNode(
            ngUrl(moduleId),
            ngPkg.cache.sourcesFileCache
          );
          node.data = { entryPoint, destinationFiles };
          node.state = 'dirty';
          ngPkg.dependsOn(node);

          return node;
        }
      );

      return graph.put(entryPoints);
    }),
    // Initialize the tsconfig for each entry point
    initTsConfigTransform,
    // perform build
    buildTransform
    // packageTransformFactory(
    //   project,
    //   {
    //     ...options,
    //     /* doesn't make sense to have watch support */
    //     watch: false,
    //   },
    //   initTsConfigTransform,
    //   analyseSourcesTransform,
    //   entryPointTransform
    // )
  );
};

const buildTransformFactory = (
  project: string,
  analyseSourcesTransform: Transform,
  entryPointTransform: Transform
) => (source$: Observable<BuildGraph>): Observable<BuildGraph> => {
  const pkgUri = ngUrl(project);
  return source$.pipe(
    // Analyse dependencies and external resources for each entry point
    analyseSourcesTransform,
    // Next, run through the entry point transformation (assets rendering, code compilation)
    scheduleEntryPoints(entryPointTransform),
    // Write npm package to dest folder
    writeNpmPackage(pkgUri),
    tap((graph) => {
      const ngPkg = graph.get(pkgUri);
      log.success(
        '\n------------------------------------------------------------------------------'
      );
      log.success(`Built Angular Package
 - from: ${ngPkg.data.src}
 - to:   ${ngPkg.data.dest}`);
      log.success(
        '------------------------------------------------------------------------------'
      );
    })
  );
};

const writeNpmPackage = (pkgUri: string): Transform =>
  pipe(
    switchMap((graph) => {
      const { data } = graph.get(pkgUri);
      const filesToCopy = Promise.all(
        [
          `${data.src}/LICENSE`,
          `${data.src}/README.md`,
          `${data.src}/CHANGELOG.md`,
        ]
          .filter((f) => fs.existsSync(f))
          .map((src) =>
            fs.copy(src, path.join(data.dest, path.basename(src)), {
              dereference: true,
              overwrite: true,
            })
          )
      );

      return from(filesToCopy).pipe(map(() => graph));
    })
  );

const scheduleEntryPoints = (epTransform: Transform): Transform =>
  pipe(
    concatMap((graph) => {
      // Calculate node/dependency depth and determine build order
      const depthBuilder = new DepthBuilder();
      const entryPoints = graph.filter(isEntryPoint);
      entryPoints.forEach((entryPoint) => {
        const deps = entryPoint.filter(isEntryPoint).map((ep) => ep.url);
        depthBuilder.add(entryPoint.url, deps);
      });

      // The array index is the depth.
      const groups = depthBuilder.build();

      // Build entry points with lower depth values first.
      return from(flatten(groups)).pipe(
        map(
          (epUrl) =>
            graph.find(
              byEntryPoint().and((ep) => ep.url === epUrl)
            ) as EntryPointNode
        ),
        filter((entryPoint) => entryPoint.state !== 'done'),
        concatMap((ep) =>
          observableOf(ep).pipe(
            // Mark the entry point as 'in-progress'
            tap((entryPoint) => (entryPoint.state = STATE_IN_PROGESS)),
            mapTo(graph),
            epTransform
          )
        ),
        takeLast(1), // don't use last as sometimes it this will cause 'no elements in sequence',
        defaultIfEmpty(graph)
      );
    })
  );
