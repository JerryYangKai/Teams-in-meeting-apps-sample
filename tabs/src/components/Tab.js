// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React from 'react';
import './App.css';
import * as microsoftTeams from "@microsoft/teams-js";
import { Avatar, Loader, Button, Label } from '@fluentui/react-northstar';
import MediaQuery from 'react-responsive';

/**
 * The 'Meeting App' component renders the content of your app.
 */
class Tab extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      context: {},
      ssoToken: "",
      consentRequired: false,
      consentProvided: false,
      graphAccessToken: "",
      photo: "",
      role: {},
      error: false
    }

    //Bind any functions that need to be passed as callbacks or used to React components.
    this.ssoLoginSuccess = this.ssoLoginSuccess.bind(this);
    this.ssoLoginFailure = this.ssoLoginFailure.bind(this);
    this.consentSuccess = this.consentSuccess.bind(this);
    this.consentFailure = this.consentFailure.bind(this);
    this.unhandledFetchError = this.unhandledFetchError.bind(this);
    this.callGraphFromClient = this.callGraphFromClient.bind(this);
    this.showConsentDialog = this.showConsentDialog.bind(this);
    this.displayInMeetingDialog = this.displayInMeetingDialog.bind(this);
    this.getParticipantInfo = this.getParticipantInfo.bind(this);
  }

  /**
   * React lifecycle method that gets called once a component has finished mounting.
   * Learn more: https://reactjs.org/docs/react-component.html#componentdidmount
   */
  componentDidMount() {
    // Initialize the Microsoft Teams SDK
    microsoftTeams.initialize();

    // Get the user context from Teams and set it in the state
    microsoftTeams.getContext((context, error) => {
      this.setState({ context: context });
    });

    //Perform single sign-on authentication
    let authTokenRequestOptions = {
      successCallback: (result) => { this.ssoLoginSuccess(result) }, //The result variable is the SSO token.
      failureCallback: (error) => { this.ssoLoginFailure(error) }
    };

    microsoftTeams.authentication.getAuthToken(authTokenRequestOptions);
  }

  ssoLoginSuccess = async (result) => {
    this.setState({ ssoToken: result });
    console.log("SSO TOKEN: ", result);
    this.exchangeClientTokenForServerToken(result);
  }

  ssoLoginFailure(error) {
    console.error("SSO failed: ", error);
    this.setState({ error: true });
  }

  /**
   * Exchange the SSO access token for a Graph access token.
   * Learn more: https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-on-behalf-of-flow
   */
  exchangeClientTokenForServerToken = async (token) => {

    let serverURL = `${process.env.REACT_APP_BASE_URL}/getGraphAccessToken?ssoToken=${token}`;
    let response = await fetch(serverURL).catch(this.unhandledFetchError); //This calls getGraphAccessToken route in /bot/index.js
    let data = await response.json().catch(this.unhandledFetchError);

    if (!response.ok && data.error === 'consent_required') {
      //A consent_required error means it's the first time a user is logging into to the app, so they must consent to sharing their Graph data with the app.
      //They may also see this error if MFA is required.
      this.setState({ consentRequired: true }); //This displays the consent required message.
      this.showConsentDialog(); //Proceed to show the consent dialogue.
    } else if (!response.ok) {
      //Unknown error
      console.error(data);
      this.setState({ error: true });
    } else {
      //Server side token exchange worked. Save the access_token to state, so that it can be picked up and used by the componentDidMount lifecycle method.
      this.setState({ graphAccessToken: data['access_token'] });
    }
  }

  /**
   * Show a popup dialogue prompting the user to consent to the required API permissions. This opens ConsentPopup.js.
   * Learn more: https://docs.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/auth-tab-aad#initiate-authentication-flow
   */
  showConsentDialog() {

    microsoftTeams.authentication.authenticate({
      url: window.location.origin + "/auth-start",
      width: 600,
      height: 535,
      successCallback: (result) => { this.consentSuccess(result) },
      failureCallback: (reason) => { this.consentFailure(reason) }
    });
  }

  /** 
   * Callback function for a successful authorization 
   */
  consentSuccess(result) {
    //Save the Graph access token in state
    this.setState({
      graphAccessToken: result,
      consentProvided: true
    });
  }

  consentFailure(reason) {
    console.error("Consent failed: ", reason);
    this.setState({ error: true });
  }

  /**
   * React lifecycle method that gets called after a component's state or props updates.
   * Learn more: https://reactjs.org/docs/react-component.html#componentdidupdate
   */
  componentDidUpdate = async (prevProps, prevState) => {

    //Check to see if a Graph access token is now in state AND that it didn't exist previously
    if ((prevState.graphAccessToken === "") && (this.state.graphAccessToken !== "")) {
      this.callGraphFromClient();

      //Check to see if this app is running in the context of a meeting, and get the user's meeting role information.
      if (this.state.context['meetingId']) {
        this.getParticipantInfo();
      }
    }
  }

  /**
   * Fetch the user's profile photo from Graph using the access token retrieved either from the server
   * or microsoftTeams.authentication.authenticate.
   */
  callGraphFromClient = async () => {
    let upn = this.state.context['upn'];
    let graphPhotoEndpoint = `https://graph.microsoft.com/v1.0/users/${upn}/photo/$value`;
    let graphRequestParams = {
      method: 'GET',
      headers: {
        'Content-Type': 'image/jpg',
        "authorization": "bearer " + this.state.graphAccessToken
      }
    }

    let response = await fetch(graphPhotoEndpoint, graphRequestParams).catch(this.unhandledFetchError);
    if (!response.ok) {
      console.error("ERROR: ", response);
      this.setState({ error: true });
    }

    let imageBlog = await response.blob().catch(this.unhandledFetchError); //Get image data as raw binary data

    this.setState({
      photo: URL.createObjectURL(imageBlog) //Convert binary data to an image URL and set the url in state
    })
  }

  /**
   * Fetch the user's meeting role information to diplay it in the app.
   */
  getParticipantInfo = async () => {
    let ssoToken = this.state.ssoToken;
    let chatId = this.state.context['chatId'];
    let meetingId = this.state.context['meetingId'];
    let userObjectId = this.state.context['userObjectId'];

    //Request must be sent from the BotFramework service, so send it to the bot to make the Bot Framework REST request
    let serverURL = `${process.env.REACT_APP_BASE_URL}/getParticipantInfo?ssoToken=${ssoToken}&conversationId=${chatId}&aadObjectId=${userObjectId}&meetingId=${meetingId}`;

    let response = await fetch(serverURL).catch(this.unhandledFetchError); //This calls getGraphAccessToken route in /bot/index.js
    let data = await response.json().catch(this.unhandledFetchError);

    if (!response.ok) {
      console.error(data);
      this.setState({ error: true });
    } else {
      this.setState({ role: data });
    }

  }

  /**
   * Display an in-meeting dialog (popup).
   */
  displayInMeetingDialog() {
    //In-meeting dialogs are triggered via the BotFramework SDK. Send the requst to the api-server.
    let serverURL = `${process.env.REACT_APP_BASE_URL}/inMeetingDialog?conversationId=${this.state.context.chatId}`;
    fetch(serverURL).catch(this.unhandledFetchError);
  }

  /**
   * Generic error handler ( avoids having to do async fetch in try/catch block ).
   */
  unhandledFetchError(err) {
    console.error("Unhandled fetch error: ", err);
    this.setState({ error: true });
  }

  render() {

    let title = Object.keys(this.state.context).length > 0 ?
      `Welcome to the meeting ${this.state.context['upn']}` : <Loader />;

    let ssoMessage = this.state.ssoToken === "" ?
      <Loader label='Performing Azure AD single sign-on authentication...' /> : null;

    let serverExchangeMessage = (this.state.ssoToken !== "") && (!this.state.consentRequired) && (this.state.photo === "") ?
      <Loader label='Exchanging SSO access token for Graph access token...' /> : null;

    let consentMessage = (this.state.consentRequired && !this.state.consentProvided) ?
      <Loader label='Consent required.' /> : null;

    let avatar = this.state.photo !== "" ?
      <Avatar image={this.state.photo} size='largest' /> : null;

    let role = Object.keys(this.state.role).length > 0 ?
      <Label color='brand' content={this.state.role.meeting.role} /> : null;

    let frameContext = Object.keys(this.state.context).length > 0 ?
      `${this.state.context.frameContext}` : null;

    let content;
    if (this.state.error) {
      content = <h1>ERROR: Please ensure pop-ups are allowed for this website and retry</h1>
    } else {
      content =
        <div>
          <h1>{avatar} {role}</h1>
          <MediaQuery maxWidth={280}>
            <h3>{title}</h3>
            <Button onClick={this.displayInMeetingDialog} primary>Show in-meeting dialog</Button>
            <p>In-meeting experience {frameContext}</p>
          </MediaQuery>
          <MediaQuery minWidth={281}>
            <h1>{title}</h1>
            <Button onClick={this.displayInMeetingDialog} primary>Show bot message</Button>
            <p>Full page app (pre-meeting/post-meeting experience) {frameContext}</p>
          </MediaQuery>
          <h3>{ssoMessage}</h3>
          <h3>{serverExchangeMessage}</h3>
          <h3>{consentMessage}</h3>
        </div>
    }

    return (
      <div className="container">
        {content}
      </div>
    );
  }
}
export default Tab;