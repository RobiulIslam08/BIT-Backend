import { Request, Response } from "express";

const notFound = ( req:Request, res:Response)=>{
	
	const message =   `API endpoint not found from notFound.ts: "${req.originalUrl}"`
	 res.status(404).json({
	  success:false,
	  message,
	  error: ''
	})
  }
export default notFound