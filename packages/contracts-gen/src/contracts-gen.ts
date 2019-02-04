#!/usr/bin/env node

import { NameResolver } from '@0x/sol-resolver';
import { PackageJSON } from '@0x/types';
import { logUtils } from '@0x/utils';
import { CompilerOptions } from 'ethereum-types';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import * as prettier from 'prettier';
import toSnakeCase = require('to-snake-case');

const SOLIDITY_EXTENSION = '.sol';
const DEFAULT_ARTIFACTS_DIR = 'artifacts';
const DEFAULT_CONTRACTS_DIR = 'contracts';
const DEFAULT_WRAPPERS_DIR = 'generated-wrappers';
const AUTO_GENERATED_BANNER = `This file is auto-generated by contracts-gen. Don't edit manually.`;
const AUTO_GENERATED_BANNER_FOR_LISTS = `This list is auto-generated by contracts-gen. Don't edit manually.`;

(async () => {
    const packageDir = process.cwd();
    const compilerJSON = readJSONFile<CompilerOptions>('compiler.json');
    const contracts = compilerJSON.contracts;
    const contractsDir = compilerJSON.contractsDir || DEFAULT_CONTRACTS_DIR;
    const artifactsDir = compilerJSON.artifactsDir || DEFAULT_ARTIFACTS_DIR;
    const wrappersDir = DEFAULT_WRAPPERS_DIR;
    if (!_.isArray(contracts)) {
        throw new Error('Unable to run the generator bacause contracts key in compiler.json is not of type array');
    }
    const prettierConfig = await prettier.resolveConfig(packageDir);
    generateCompilerJSONContractsList(contracts, contractsDir, prettierConfig);
    generateArtifactsTs(contracts, artifactsDir, prettierConfig);
    generateWrappersTs(contracts, wrappersDir, prettierConfig);
    generateTsConfigJSONFilesList(contracts, artifactsDir, prettierConfig);
    generatePackageJSONABIConfig(contracts, artifactsDir, prettierConfig);
    process.exit(0);
})().catch(err => {
    logUtils.log(err);
    process.exit(1);
});

function generateCompilerJSONContractsList(
    contracts: string[],
    contractsDir: string,
    prettierConfig: prettier.Options | null,
): void {
    const COMPILER_JSON_FILE_PATH = 'compiler.json';
    const compilerJSON = readJSONFile<CompilerOptions>(COMPILER_JSON_FILE_PATH);
    compilerJSON.contracts = _.map(contracts, contract => {
        if (contract.endsWith(SOLIDITY_EXTENSION)) {
            // If it's already a relative path - NO-OP.
            return contract;
        } else {
            // If it's just a contract name - resolve it and rewrite.
            return new NameResolver(contractsDir).resolve(contract).path;
        }
    });
    compilerJSON.contracts = _.sortBy(compilerJSON.contracts);
    const compilerJSONString = JSON.stringify(compilerJSON);
    const formattedCompilerJSON = prettier.format(compilerJSONString, {
        ...prettierConfig,
        filepath: COMPILER_JSON_FILE_PATH,
    });
    fs.writeFileSync(COMPILER_JSON_FILE_PATH, formattedCompilerJSON);
}

function generateArtifactsTs(contracts: string[], artifactsDir: string, prettierConfig: prettier.Options | null): void {
    const imports = _.map(contracts, contract => {
        const contractName = path.basename(contract, SOLIDITY_EXTENSION);
        const importPath = path.join('..', artifactsDir, `${contractName}.json`);
        return `import * as ${contractName} from '${importPath}';`;
    });
    const sortedImports = _.sortBy(imports);
    const artifacts = _.map(contracts, contract => {
        const contractName = path.basename(contract, SOLIDITY_EXTENSION);
        if (contractName === 'ZRXToken') {
            // HACK(albrow): "as any" hack still required here because ZRXToken does not
            // conform to the v2 artifact type.
            return `${contractName}: (${contractName} as any) as ContractArtifact,`;
        } else {
            return `${contractName}: ${contractName} as ContractArtifact,`;
        }
    });
    const artifactsTs = `
    // ${AUTO_GENERATED_BANNER}
    import { ContractArtifact } from 'ethereum-types';

    ${sortedImports.join('\n')}
    export const artifacts = {${artifacts.join('\n')}};
    `;
    const ARTIFACTS_TS_FILE_PATH = 'src/artifacts.ts';
    const formattedArtifactsTs = prettier.format(artifactsTs, { ...prettierConfig, filepath: ARTIFACTS_TS_FILE_PATH });
    fs.writeFileSync(ARTIFACTS_TS_FILE_PATH, formattedArtifactsTs);
}

function generateWrappersTs(contracts: string[], wrappersDir: string, prettierConfig: prettier.Options | null): void {
    const imports = _.map(contracts, contract => {
        const contractName = path.basename(contract, SOLIDITY_EXTENSION);
        const outputFileName = makeOutputFileName(contractName);
        const exportPath = path.join('..', wrappersDir, outputFileName);
        return `export * from '${exportPath}';`;
    });
    const sortedImports = _.sortBy(imports);
    const wrappersTs = `
    // ${AUTO_GENERATED_BANNER}
    ${sortedImports.join('\n')}
    `;
    const WRAPPERS_TS_FILE_PATH = 'src/wrappers.ts';
    const formattedArtifactsTs = prettier.format(wrappersTs, { ...prettierConfig, filepath: WRAPPERS_TS_FILE_PATH });
    fs.writeFileSync(WRAPPERS_TS_FILE_PATH, formattedArtifactsTs);
}

function generateTsConfigJSONFilesList(
    contracts: string[],
    artifactsDir: string,
    prettierConfig: prettier.Options | null,
): void {
    const TS_CONFIG_FILE_PATH = 'tsconfig.json';
    const tsConfig = readJSONFile<any>(TS_CONFIG_FILE_PATH);
    tsConfig.files = _.map(contracts, contract => {
        const contractName = path.basename(contract, SOLIDITY_EXTENSION);
        const artifactPath = path.join(artifactsDir, `${contractName}.json`);
        return artifactPath;
    });
    tsConfig.files = _.sortBy(tsConfig.files);
    const tsConfigString = JSON.stringify(tsConfig);
    const formattedTsConfig = prettier.format(tsConfigString, { ...prettierConfig, filepath: TS_CONFIG_FILE_PATH });
    fs.writeFileSync(TS_CONFIG_FILE_PATH, formattedTsConfig);
}

function generatePackageJSONABIConfig(
    contracts: string[],
    artifactsDir: string,
    prettierConfig: prettier.Options | null,
): void {
    let packageJSON = readJSONFile<PackageJSON>('package.json');
    const contractNames = _.map(contracts, contract => {
        const contractName = path.basename(contract, SOLIDITY_EXTENSION);
        return contractName;
    });
    const sortedContractNames = _.sortBy(contractNames);
    packageJSON = {
        ...packageJSON,
        config: {
            ...packageJSON.config,
            'abis:comment': AUTO_GENERATED_BANNER_FOR_LISTS,
            abis: `${artifactsDir}/@(${sortedContractNames.join('|')}).json`,
        },
    };
    const PACKAGE_JSON_FILE_PATH = 'package.json';
    const packageJSONString = JSON.stringify(packageJSON);
    const formattedPackageJSON = prettier.format(packageJSONString, {
        ...prettierConfig,
        filepath: PACKAGE_JSON_FILE_PATH,
    });
    fs.writeFileSync(PACKAGE_JSON_FILE_PATH, formattedPackageJSON);
}

function makeOutputFileName(name: string): string {
    let fileName = toSnakeCase(name);
    // HACK: Snake case doesn't make a lot of sense for abbreviated names but we can't reliably detect abbreviations
    // so we special-case the abbreviations we use.
    fileName = fileName.replace('z_r_x', 'zrx').replace('e_r_c', 'erc');
    return fileName;
}

function readJSONFile<T>(filePath: string): T {
    const JSONString = fs.readFileSync(filePath, 'utf8');
    const parsed: T = JSON.parse(JSONString);
    return parsed;
}
