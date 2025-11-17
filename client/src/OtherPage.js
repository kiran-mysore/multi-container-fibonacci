import React from "react";
import { Link } from "react-router-dom";

const OtherPage = () => {
  return (
    <div>
      <h1>I am on the Other Page</h1>
      <Link to="/">Let's Go Back Home</Link>
    </div>
  );
};

export default OtherPage;