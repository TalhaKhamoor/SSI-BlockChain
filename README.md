
# SSI Web Application 

This system was built as a proof of concept that highlights the use of Evernym provided source code called “customer-toolkit”. In a more general sense, it promotes self-sovereign identity under the Sovrin Network. It utilizes Immutable Decentralized Identifiers (DID’s) on a  Blockchain via the Web Application that the SSI Capstone group has created. Particularly, this web application deals with using those DID’s to create connections between a Certificate  Authority (SAIT Registrar or ABC University) and prospective Students. By forming these connections between the SSI’s web application and the Evernym provided cell phone app, users can transfer verifiable credentials.  The purpose of this system is to provide an easy, secure, and verifiable way for students to access their academic transcripts. The system provides students with a digital copy of their transcript, which is kept in a secure “digital wallet” on their phone.

// Installation

To install the SSI Web Application, VirtualBox and Vagrant must be installed first. The following instructions cover installation on a Windows environment. Begin with installing VirtualBox.

_It is assumed that SAIT administration and instructors are using the Windows 10 operating system, therefore, instructions for Vagrant installation (works on Windows 10), rather than the Docker installation (only works on Mac & Linux), are included._

## VirtualBox Installation

1. Go to https://www.virtualbox.org .

2. Click the **Downloads** link in the sidebar.

3. Under the **Platform Packages** section, select the link for Windows hosts (this will download the latest Windows compatible version of VirtualBox).

4. Run the downloaded VirtualBox setup executable.

5. Select a location to install VirtualBox.

6. Click the **Next** button.

7. Click the **Yes** button when the **Network Interfaces** warning is encountered.

_VirtualBox will start to install on your computer. This process may take several minutes._

8. Once VirtualBox installation is complete, proceed to install Vagrant on your system.

## Vagrant Installation

1. Go to https://vagrantup.com .

2. Click the **Download 2.2.9** button.

3. Choose Windows as the operating system.

4. Make sure you are downloading the 64-bit version.

5. Run the downloaded Vagrant setup executable.

6. Click **Next**.

7. Agree to the terms of the License Agreement.

8. Select a location to install Vagrant.

9. Click the **Install** button.

_Vagrant will start to install on your computer. This process may take several minutes._

10. Click the **Finish** button.

11. Click the **Yes** button (this will restart your system).

12. Once your system has restarted, the Vagrant installation is complete. You can now proceed to install the **CustomerToolkit** (the SSI Web Application).

## CustomerToolkit Installation (SSI Web Application)

1. Unzip the provided toolkit at a chosen location.

2. Navigate into the **customer-toolkit** folder using file explorer (this is where the vagrant file is located).

3. In the navigation bar type **cmd** and hit enter (this should open a command line interface at the current folder location).

4. Create a vagrant virtual machine using the following commands.

```
	vagrant up
```

_This will create a Linux based virtual machine. This process may take several minutes._

5. Once the virtual machine has been created, enter the following commands.

```
	vagrant ssh
```

_This will access the virtual machine. This process may take a moment._

6. Change into the install directory and start the install wizard using the following commands.

```
	cd vcx-vagrant/install/
	bash install-wizard-win.sh
```

7. When prompted to enter a **32 Character Enterprise Seed**, leave it blank and hit enter.

8. When prompted to enter an **Image URL**, leave it blank and hit enter.

9. When prompted to enter an **Institution Name**, enter your institution name (e.g. SAIT Office of the Registrar).

10. When prompted to enter an **absolute path to the genesis.txn file**, leave it blank and hit enter.

11. When prompted to enter an **Agency Server**, leave it blank and hit enter.

_The installation process will begin and may take several minutes._

_If there were any errors made in the previous 5 steps, hit **CTRL+Z** to escape, and enter `bash install-wizard-win.sh` to try again._

12. Once the installation has completed, an **Institution DID** and an **Institution Verkey** will be provided. **Note these values down.**

13. Go to https://selfserve.sovrin.org/ .

14. Change the **Network** to **StagingNet**.

15. Enter the **Institution DID** and **Institution Verkey** values provided earlier.

16. Leave **Payment-Address** empty.

17. Click the **Submit** button.

18. Enter http://172.28.128.99/login.html into the web browser address bar.

_You should see the SSI Web Application login page in your web browser to confirm a successful setup._

# SSI Web Application Uninstallation Procedure

To uninstall the SSI Web Application, follow the following steps.

1. Open **Add or Remove Programs** in the Windows System Settings.

2. Find VirtualBox and Vagrant, click on them, and click the **uninstall** button.

_This will fully remove VirtualBox and Vagrant from your computer._

3. Delete the **customer-toolkit** folder and its contents.

_The SSI Web Application is now completely uninstalled._

# Troubleshooting

If the QR codes do not appear, restarting the Vagrant service should fix any problems. The following steps restart Vagrant.

1. Navigate into the **customer-toolkit** folder using file explorer (this is where the vagrant file is located).

2. In the navigation bar type **cmd** and hit enter (this should open a command line interface at the current folder location).

3. Use the following commands to restart Vagrant.

```
	vagrant up
	vagrant ssh
	sudo systemctl restart VCXWebApp-win.service
```

_Each command may take a few minutes to process. After the processes are complete, the Vagrant service will have restarted, and the QR codes should appear in the SSI web application._
