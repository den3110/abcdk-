import PropTypes from "prop-types";
import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";

export default function AppInitGate({ children }) {
  useGetAppInitQuery();
  return children;
}

AppInitGate.propTypes = {
  children: PropTypes.node.isRequired,
};