import mongoose, { Document, Schema, model } from 'mongoose';
import { z } from 'zod';


export interface IUser extends Document {
    _id?: Schema.ObjectId;
    name: string;
    email: string;
    password: string;
    last: number;
    timestamp: number;
    confirmed: number;
    audited: number;
}

const userSchema = new Schema({
    name: {
        index: true,
        type: String,
        required: true,
        min: 3, max: 64,
    },
    email: {
        index: true,
        type: String,
        match: /.+\@.+\..+/,
        lowercase: true,
        required: true,
        unique: true,
        min: 9, max: 64,
    },
    password: {
        type: String,
        // required: true,
    },
    last: { type: Number },
    confirmed: { type: Number },
    audited: { type: Number },
}, { timestamps: true })

const User = mongoose.models.user || model<IUser>('user', userSchema)
export default User





export const SignupFormSchema = z.object({
  name: z
    .string()
    .min(2, { message: 'Name must be at least 2 characters long.' })
    .trim(),
  email: z.string().email({ message: 'Please enter a valid email.' }).trim(),
  password: z
    .string()
    .min(8, { message: 'Be at least 8 characters long' })
    .regex(/[a-zA-Z]/, { message: 'Contain at least one letter.' })
    .regex(/[0-9]/, { message: 'Contain at least one number.' })
    .regex(/[^a-zA-Z0-9]/, {
      message: 'Contain at least one special character.',
    })
    .trim(),
});

export const LoginFormSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email.' }),
  password: z.string().min(1, { message: 'Password field must not be empty.' }),
});

export type FormState =
  | {
      errors?: {
        name?: string[];
        email?: string[];
        password?: string[];
      };
      message?: string;
    }
  | undefined;

export type SessionPayload = {
  userId: string | number;
  expiresAt: Date;
};

// class Token(BaseModel):
//     id: PyObjectId = Field(default_factory=uuid.uuid4, alias="_id")
//     access_token: Optional[str] = None
//     access_expiration: Optional[float] = None
//     refresh_token: Optional[str] = None
//     refresh_expiration: Optional[float] = None
//     user: PyObjectId

//     @property
//     def access_token_jwt(self):
//         return jwt.encode({'token': self.access_token},
//                           current_app.config['SECRET_KEY'],
//                           algorithm='HS256')

//     def generate(self):
//         self.access_token = secrets.token_urlsafe()
//         self.access_expiration = (datetime.now(timezone.utc) + \
//             timedelta(minutes=current_app.config['ACCESS_TOKEN_MINUTES'])).timestamp()
//         self.refresh_token = secrets.token_urlsafe()
//         self.refresh_expiration = (datetime.now(timezone.utc) + \
//             timedelta(days=current_app.config['REFRESH_TOKEN_DAYS'])).timestamp()

//     def expire(self, delay=None):
//         if delay is None:  # pragma: no branch
//             # 5 second delay to allow simultaneous requests
//             delay = 5 if not current_app.testing else 0
//         db.token.update_one({'_id': self.id}, {'$set': {
//             'access_expiration': (datetime.now(timezone.utc) + timedelta(seconds=delay)).timestamp(),
//             'refresh_expiration': (datetime.now(timezone.utc) + timedelta(seconds=delay)).timestamp()
//         }})

//     @staticmethod
//     def clean():
//         """Remove any tokens that have been expired for more than a day."""
//         yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).timestamp()
//         db.token.delete_many({'refresh_expiration': {'$lt': yesterday}})

//     @staticmethod
//     def from_jwt(access_token_jwt):
//         access_token = None
//         try:
//             access_token = jwt.decode(access_token_jwt,
//                                       current_app.config['SECRET_KEY'],
//                                       algorithms=['HS256'])['token']
//             tk = db.token.find_one({'access_token': access_token})
//             if tk:
//                 token = Token(**tk)
//                 return token
//         except jwt.PyJWTError:
//             pass