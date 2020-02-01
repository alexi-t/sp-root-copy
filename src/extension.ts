'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { searchFileAscending, parseXML } from './helpers';
import { SPDataFile, ProjectItemFile } from './SPDataFileSchema';

let regedit = require('regedit');

const readFile = util.promisify(fs.readFile);
const readDir = util.promisify(fs.readdir);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    var copyController = new SPCopyController();

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


    private async _deployElementFile(filePath: string, relatedSPDataPath: string, pathInFeature: string) {
        const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
        const csProjFile = await searchFileAscending(path.dirname(filePath), f => f.indexOf(".csproj") > -1);
        const projectDir = path.dirname(csProjFile);
        const spDataRelativeToProjectRoot = path.relative(projectDir, relatedSPDataPath);
        if (csProjFile) {
            const result = await parseXML<any>(await readFile(csProjFile));
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
                    const result = await parseXML<any>(feature);
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
                            this._log(`Copy {Workspace}\\${path.relative(workspaceRoot, filePath)} -> {Template}\\${path.relative(this._spTemplatePath, copyTarget)}`);
                            fs.copyFile(filePath, copyTarget, (e) => {
                                console.log('error copy ' + e.message);
                            });
                        }
                    }
                }
            }
        }
    }

    private _deployTemplateFile(deployType: string, targetFolder: string, spDataItemFile: string, sourceFilePath: string) {
        const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
        const filePathRelaticeToSPDir = path.relative(path.dirname(spDataItemFile), sourceFilePath);

        const spBasePath =
            deployType == 'TemplateFile' ?
                this._spTemplatePath :
                path.resolve(this._spTemplatePath, '..');

        const targetFilePath = path.join(spBasePath, targetFolder, filePathRelaticeToSPDir);

        this._log(`Copy {Workspace}\\${path.relative(workspaceRoot, sourceFilePath)} -> ${deployType == 'RootFile' ? '{Root}' : '{Template}'}\\${path.relative(spBasePath, targetFilePath)}`)

        fs.copyFile(sourceFilePath, targetFilePath, (e) => {
            console.log('error copy ' + e.message);
        });
    }

    public async copyFile(sourceFilePath: string) {
        if (!this._spTemplatePath)
            return;

        const fileDir = path.dirname(sourceFilePath);
        const fileName = path.basename(sourceFilePath);

        const spDataItemFile = await searchFileAscending(fileDir, (f) => f == 'SharePointProjectItem.spdata');

        if (!spDataItemFile)
            return;

        const fileStream = await readFile(spDataItemFile);
        const spData = await parseXML<SPDataFile>(fileStream);

        if (spData.ProjectItem.$.Type == "Microsoft.VisualStudio.SharePoint.MappedFolder") {
            const mappedFolder = spData.ProjectItem.ProjectItemFolder![0];
            if (mappedFolder) {
                const deployType = mappedFolder.$.Type;
                const targetFolder = mappedFolder.$.Target;
                this._deployTemplateFile(deployType, targetFolder, spDataItemFile, sourceFilePath);
                this._log(`Deployed at ${new Date()}`);
            }
        } else {
            let relatedProjectItem: ProjectItemFile | undefined;
            if (spData.ProjectItem.Files && spData.ProjectItem.Files[0]) {
                const files = spData.ProjectItem.Files[0].ProjectItemFile;
                if (files)
                    for (let i = 0; i < files.length; i++) {
                        const projectItemFile = files[i];
                        if (projectItemFile.$.Source === fileName) {
                            relatedProjectItem = projectItemFile;
                        }
                    }
            }
            if (!relatedProjectItem) {

            } else {
                if (relatedProjectItem.$.Type == "ElementFile") {
                    await this._deployElementFile(sourceFilePath, spDataItemFile, relatedProjectItem.$.Target);
                    this._log(`Deployed at ${new Date()}`);
                } else
                    if (relatedProjectItem.$.Type == "TemplateFile") {
                        this._deployTemplateFile(relatedProjectItem.$.Type, relatedProjectItem.$.Target, spDataItemFile, sourceFilePath);
                        this._log(`Deployed at ${new Date()}`);
                    }
            }
        }
    }

    dispose() {
        this._statusBarItem.dispose();
        this._output.dispose();
    }
}

class SPCopyController {

    private _disposable: vscode.Disposable;
    private _copier: SPCopier;

    constructor() {
        this._copier = new SPCopier();

        let subscriptions: vscode.Disposable[] = [this._copier];
        vscode.workspace.onDidSaveTextDocument(this._onDocumentSave, this, subscriptions);

        this._disposable = vscode.Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable.dispose();
    }

    private _onDocumentSave(doc: vscode.TextDocument) {
        var filePath = doc.fileName;
        this._copier.copyFile(filePath);
    }
}