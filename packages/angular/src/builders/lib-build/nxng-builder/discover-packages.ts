/**
 * Adapted function from original ng-packagr. This one excludes
 * the search for secondary entry points since that's not needed
 * for incremental compilation
 */

import * as path from 'path';
import { NgPackage } from 'ng-packagr/lib/ng-package/package';
import { NgEntryPoint } from 'ng-packagr/lib/ng-package/entry-point/entry-point';
import { lstat, pathExistsSync } from 'fs-extra';
import * as ajv from 'ajv';
import * as log from 'ng-packagr/lib/utils/log';
import { tap } from 'rxjs/operators';

const ngPackageSchemaJson = require('ng-packagr/ng-package.schema.json');

interface UserPackage {
  /** Values from the `package.json` file of this user package. */
  packageJson: Record<string, any>;
  /** NgPackageConfig for this user package. */
  ngPackageJson: Record<string, any>;
  /** Absolute directory path of this user package. */
  basePath: string;
}

export async function discoverPackages(project: string) {
  project = path.isAbsolute(project) ? project : path.resolve(project);

  const { packageJson, ngPackageJson, basePath } = await resolveUserPackage(
    project
  );

  const primary = new NgEntryPoint(packageJson, ngPackageJson, basePath);
  log.debug(`Found primary entry point: ${primary.moduleId}`);

  return new NgPackage(basePath, primary, []);
}

async function resolveUserPackage(
  folderPathOrFilePath: string,
  isSecondary = false
): Promise<UserPackage | undefined> {
  const readConfigFile = async (filePath: string) =>
    pathExistsSync(filePath) ? import(filePath) : undefined;
  const fullPath = path.resolve(folderPathOrFilePath);
  const pathStats = await lstat(fullPath);
  const basePath = pathStats.isDirectory() ? fullPath : path.dirname(fullPath);
  const packageJson: unknown = await readConfigFile(
    path.join(basePath, 'package.json')
  );

  if (!packageJson && !isSecondary) {
    throw new Error(
      `Cannot discover package sources at ${folderPathOrFilePath} as 'package.json' was not found.`
    );
  }

  if (packageJson && typeof packageJson !== 'object') {
    throw new Error(`Invalid 'package.json' at ${folderPathOrFilePath}.`);
  }

  let ngPackageJson: unknown;
  if (packageJson && packageJson['ngPackage']) {
    // Read `ngPackage` from `package.json`
    ngPackageJson = { ...packageJson['ngPackage'] };
  } else if (pathStats.isDirectory()) {
    ngPackageJson = await readConfigFile(
      path.join(basePath, 'ng-package.json')
    );
    if (!ngPackageJson) {
      ngPackageJson = await readConfigFile(
        path.join(basePath, 'ng-package.js')
      );
    }
  } else {
    ngPackageJson = await readConfigFile(fullPath);
  }

  if (ngPackageJson) {
    const _ajv = ajv({
      schemaId: 'auto',
      useDefaults: true,
      jsonPointers: true,
    });

    const validate = _ajv.compile(ngPackageSchemaJson);
    // Add handler for x-deprecated fields
    _ajv.addKeyword('x-deprecated', {
      validate: (
        schema,
        _data,
        _parentSchema,
        _dataPath,
        _parentDataObject,
        propertyName
      ) => {
        if (schema) {
          log.warn(
            `Option "${propertyName}" is deprecated${
              typeof schema == 'string' ? ': ' + schema : '.'
            }`
          );
        }

        return true;
      },
      errors: false,
    });

    const isValid = validate(ngPackageJson);
    if (!isValid) {
      throw new Error(
        `Configuration doesn\'t match the required schema.\n${formatSchemaValidationErrors(
          validate.errors
        )}`
      );
    }

    return {
      basePath,
      packageJson: packageJson || {},
      ngPackageJson: ngPackageJson as Record<string, any>,
    };
  }

  if (pathStats.isDirectory()) {
    // return even if it's undefined and use defaults when it's not a file
    return undefined;
  }

  if (pathStats.isFile()) {
    // a project file was specified but was in valid
    if (path.basename(folderPathOrFilePath) === 'package.json') {
      throw new Error(
        `Cannot read a package from 'package.json' without 'ngPackage' property.`
      );
    }

    throw new Error(
      `Trying to read a package from unsupported file extension. Path: ${folderPathOrFilePath}`
    );
  }

  throw new Error(`Cannot discover package sources at ${folderPathOrFilePath}`);
}
