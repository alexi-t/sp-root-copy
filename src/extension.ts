'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const xml2js = require('xml2js');
let regedit = require('regedit');

const readFile = util.promisify(fs.readFile);
const readDir = util.promisify(fs.readdir);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    var copier = new SPCopier();
    var copyController = new SPCopyController(copier);

    context.subscriptions.push(copyController);

}

// this method is called when your extension is deactivated
export function deactivate() {
}

class SPCopier {
    private _spTemplatePath = '';
    private _statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    private _output = vscode.window.createOutputChannel("SP Copy");

    constructor() {
        const spRegKey = 'HKLM\\SOFTWARE\\Microsoft\\Office Server';

        this._log('SPCopy try to search SP path');

        regedit.list([spRegKey], (err: any, result: any) => {
            if (result[spRegKey]) {
                var versions = result[spRegKey].keys;
                var lastest = versions.pop();
                this._log(`Latest SP version is ${lastest}`);
                this._statusBarItem.text = 'SP Version: ' + lastest;
                this._statusBarItem.show();

                regedit.list([spRegKey + '\\' + lastest], (err: any, result: any) => {
                    if (result[spRegKey + '\\' + lastest]) {
                        this._spTemplatePath = result[spRegKey + '\\' + lastest].values['TemplatePath'].value;
                        this._log(`Template path set as ${this._spTemplatePath}`);
                    }
                });
            } else {
                console.log('SPCopy can not find SP template path');
            }
        });
    }

    private _log(msg: string) {
        console.log(msg);
        this._output.appendLine(msg);
    }


    private _searchSPDataFile(startDir: string, callback: (spDataPath: string) => void) {
        var currentDir = startDir;
        var _searchDir = (err: NodeJS.ErrnoException, files: string[]) => {
            var spDataFound: boolean = false;
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (file == 'SharePointProjectItem.spdata') {
                    spDataFound = true;
                    callback(path.join(currentDir, file));
                    break;
                }
            }
            if (!spDataFound) {
                currentDir = path.resolve(currentDir, '..');
                if (currentDir.length > vscode.workspace.workspaceFolders![0].uri.fsPath.length)
                    fs.readdir(currentDir, _searchDir);
            }
        }
        fs.readdir(currentDir, _searchDir);
    }

    private _searchForCsProjFile(startDir: string): Promise<string> {
        var currentDir = startDir;
        return new Promise<string>((r, e) => {
            const _searchDir = (err: NodeJS.ErrnoException, files: string[]) => {
                var csProjFound: boolean = false;
                for (var i = 0; i < files.length; i++) {
                    var file = files[i];
                    if (file.indexOf('.csproj') > -1) {
                        csProjFound = true;
                        r(path.join(currentDir, file));
                        break;
                    }
                }
                if (!csProjFound) {
                    currentDir = path.resolve(currentDir, '..');
                    if (currentDir.length >= vscode.workspace.workspaceFolders![0].uri.fsPath.length)
                        fs.readdir(currentDir, _searchDir);
                }
            }
            fs.readdir(currentDir, _searchDir);
        });
    }

    private async _deployModuleFile(filePath: string, relatedSPDataPath: string, pathInFeature: string) {
        const csProjFile = await this._searchForCsProjFile(path.dirname(filePath));
        const projectDir = path.dirname(csProjFile);
        const spDataRelativeToProjectRoot = path.relative(projectDir, relatedSPDataPath);
        if (csProjFile) {
            const parser = new xml2js.Parser();
            parser.parseString(
                await readFile(csProjFile),
                async (err: any, result: any) => {
                    let moduleSPDataId = '';
                    for (let i = 0; i < result.Project.ItemGroup.length; i++) {
                        const itemGroup = result.Project.ItemGroup[i].None;
                        if (!itemGroup)
                            continue;
                        for (let j = 0; j < itemGroup.length; j++) {
                            const item = itemGroup[j];
                            if (item.$.Include === spDataRelativeToProjectRoot) {
                                moduleSPDataId = item.SharePointProjectItemId[0].replace(/(\{|\})/g, '');
                                break;
                            }
                        }
                        if (moduleSPDataId)
                            break;
                    }

                    if (moduleSPDataId) {
                        const features = (await readDir(path.join(projectDir, 'Features')));
                        for (let i = 0; i < features.length; i++) {
                            const featureName = features[i];
                            const feature = await readFile(path.join(projectDir, 'Features', featureName, featureName + '.feature'));
                            parser.parseString(feature,
                                async (err: any, result: any) => {
                                    const featureItems = result.feature.projectItems[0].projectItemReference;
                                    for (let j = 0; j < featureItems.length; j++) {
                                        const featureItem = featureItems[j];
                                        if (featureItem.$.itemId === moduleSPDataId) {
                                            const featureDeploymentPath =
                                                result.feature.$.deploymentPath
                                                    .replace('$SharePoint.Project.FileNameWithoutExtension$', path.basename(projectDir))
                                                    .replace('$SharePoint.Feature.FileNameWithoutExtension$', featureName);
                                            const copyTarget =
                                                path.join(
                                                    this._spTemplatePath,
                                                    'FEATURES',
                                                    featureDeploymentPath,
                                                    pathInFeature,
                                                    path.basename(filePath));
                                            this._log(`Copy ${filePath} -> ${copyTarget}`);
                                            fs.copyFile(filePath, copyTarget, (e) => {
                                                console.log('error copy ' + e.message);
                                            });
                                        }
                                    }
                                });
                        }
                    }
                });
        }
    }

    public copyFile(sourceFilePath: string) {
        if (!this._spTemplatePath)
            return;

        const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
        const fileDir = path.dirname(sourceFilePath);
        const fileName = path.basename(sourceFilePath);

        this._searchSPDataFile(fileDir, (spDataPath) => {
            fs.readFile(spDataPath, (err, data) => {
                var parser = new xml2js.Parser();
                parser.parseString(data, (err: any, result: any) => {
                    let relatedProjectItem = null;
                    if (result.ProjectItem.Files && result.ProjectItem.Files[0]) {
                        const files = result.ProjectItem.Files[0].ProjectItemFile;
                        for (let i = 0; i < files.length; i++) {
                            const projectItemFile = files[i];
                            if (projectItemFile.$.Source === fileName) {
                                relatedProjectItem = projectItemFile;
                            }
                        }
                    }
                    let itemType = result.ProjectItem.$.Type;
                    if (itemType === 'Microsoft.VisualStudio.SharePoint.Module') {
                        this._log(`Try deploy ${relatedProjectItem.$.Source} as part of module`)
                        this._deployModuleFile(sourceFilePath, spDataPath, relatedProjectItem.$.Target).then(() => {
                            this._log(`Deployed at ${new Date()}`);
                        });
                    } else {
                        var deployType = result.ProjectItem.ProjectItemFolder[0].$.Type;

                        var deployTargetDir = result.ProjectItem.ProjectItemFolder[0].$.Target;
                        var deploySourceDir = path.dirname(spDataPath);

                        var deployRelativePath = path.relative(deploySourceDir, sourceFilePath);

                        var deployBase =
                            deployType == 'TemplateFile' ?
                                this._spTemplatePath :
                                path.resolve(this._spTemplatePath, '..');

                        var deployTargetFile = path.join(deployBase, deployTargetDir, deployRelativePath);
                        console.log(`Copy to root {Workspace}\\${path.relative(workspaceRoot, sourceFilePath)} -> ${deployType == 'RootFile' ? '{Root}' : '{Template}'}\\${path.relative(deployBase, deployTargetFile)}`);
                        fs.copyFile(sourceFilePath, deployTargetFile, (e) => {
                            console.log('error copy ' + e.message);
                        });
                    }
                });
            });
        });
    }

    dispose() {
        this._statusBarItem.dispose();
        this._output.dispose();
    }
}

class SPCopyController {

    private _disposable: vscode.Disposable;
    private _copier: SPCopier;

    constructor(copier: SPCopier) {
        this._copier = copier;

        // subscribe to selection change and editor activation events
        let subscriptions: vscode.Disposable[] = [];
        vscode.workspace.onDidSaveTextDocument(this._onEvent, this, subscriptions);

        // create a combined disposable from both event subscriptions
        this._disposable = vscode.Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable.dispose();
    }

    private _onEvent(doc: vscode.TextDocument) {
        var filePath = doc.fileName;
        console.log('start copy ' + filePath);
        this._copier.copyFile(filePath);
    }
}