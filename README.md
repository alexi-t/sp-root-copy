# Sharepoint autocopy

## Features

Auto detects if Sharepoint is installed and if so looks for nearest .spdata file and copy file to sharepoint root or template folder.

## Requirements

You will need sharepoint installed on local machine.

## How to use

Just open your csproj or solution folder as workspace and edit some documents which has following types:

* Files from mapped folders: CONTROLTEMPLATES, LAYOUTS and so on, root files from other folder like XML also supported
* Files from modules which had been deployed as Ghostable: pages, page layouts, etc
* Files from Visual WebPart Onpremise template,

## Release Notes

Source code [here](https://github.com/alexi-t/sp-root-copy)

### 0.1.0

Initial release ~~may~~ contain some bugs. Test with SP 2016.

### 0.2.0

Auto copy of module files now supported, module must be included in a feature

### 0.3.0

* support auto copy for Visual Web parts elements
* added log source SPCopy with detailed info about file copying